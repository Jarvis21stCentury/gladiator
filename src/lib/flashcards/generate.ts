import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { CanvasClient } from "@/lib/canvas/client";
import { getCanvasConfig, hasApiCredentials } from "@/lib/canvas/config";
import { htmlToText } from "@/lib/digest/html";
import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";

/**
 * Writing cards for a class.
 *
 * The material is `LessonNote.keyPoints` — what the nightly digest already
 * distilled. The schema comment on that field says each point should be
 * "self-contained enough to become a card", and this is the thing that cashes
 * that in: one model call per night's notes, turning points into questions,
 * rather than a second pass over the raw textbook text at a second cost.
 *
 * A card's identity is the key point it came from, not its wording. Rerunning
 * over a note rewrites its cards in place and keeps their scheduling history,
 * which is what makes "regenerate" safe to press on a deck you've been
 * reviewing for a month.
 */

const CardSchema = z.object({
  cards: z
    .array(
      z.object({
        /** Index into the key points supplied, so a card keeps its identity. */
        sourceIndex: z.number().int().min(0),
        front: z.string().min(1),
        back: z.string().min(1),
        hint: z.string().nullable().optional(),
      }),
    )
    .max(40),
});

const SYSTEM_PROMPT = [
  "You write revision flashcards for a high-school student from notes taken in their own classes.",
  "",
  "Rules:",
  "- One card tests exactly one idea. If a note point holds two ideas, write two cards.",
  "- The front is a question the student can answer from memory. Never a yes/no question.",
  "- The back is the answer alone: one or two sentences, no preamble, no restating the question.",
  "- Never write a card whose answer is contained in its own question.",
  "- Skip a point entirely if it is administrative (due dates, room changes, what to bring) rather than something to learn.",
  "- Use the wording and notation of the source material. Do not introduce terms the notes never used.",
  "- hint: where in the material this came from, if the notes make that obvious. Otherwise null.",
  "",
  "Return sourceIndex as the index of the note point each card came from.",
].join("\n");

/** Stable per key point, so regeneration updates rather than duplicates. */
function signatureFor(noteId: string, sourceIndex: number, ordinal: number) {
  const raw = `${noteId}:${sourceIndex}:${ordinal}`;
  return createHash("sha1").update(raw).digest("hex").slice(0, 32);
}

/**
 * The system prompt for raw material, which is a harder job than key points.
 *
 * Distilling and rephrasing are one step here instead of two, so the rules
 * about what *not* to make a card from have to be much louder: raw course
 * material is full of due dates, room numbers and "bring your calculator", and
 * a deck of administrative trivia is worse than no deck.
 */
const RAW_SYSTEM_PROMPT = [
  "You write revision flashcards for a high-school student directly from their course material.",
  "",
  "The material is raw — a teacher's page, a syllabus, an assessment plan, a posted reading. Most of it is not worth learning. Your first job is deciding what is.",
  "",
  "Write a card only for something the student could be *tested* on: a definition, a mechanism, a formula, a cause, a named concept, a worked relationship.",
  "",
  "Never write a card for:",
  "- due dates, test dates, deadlines, or anything about scheduling",
  "- room numbers, materials to bring, grading policy, late-work policy",
  "- assignment titles with no content behind them",
  "- the name of a unit or chapter on its own",
  "",
  "Rules for the cards you do write:",
  "- One card tests exactly one idea.",
  "- The front is a question answerable from memory. Never yes/no.",
  "- The back is the answer alone: one or two sentences, no preamble.",
  "- Never write a card whose answer is contained in its own question.",
  "- Use the wording and notation of the material. Do not introduce terms it never used.",
  "- hint: where in the material it came from, when that is obvious. Otherwise null.",
  "",
  "Return an empty list if the material is entirely administrative. That is a correct and common answer — inventing content to fill a deck is worse than returning nothing.",
  "",
  "Set sourceIndex to 0 for every card.",
].join("\n");

/** Stable per card for raw material, keyed on the source it was read from. */
function rawSignature(sourceId: string, ordinal: number) {
  return createHash("sha1")
    .update(`raw:${sourceId}:${ordinal}`)
    .digest("hex")
    .slice(0, 32);
}

export interface GenerateCardsResult {
  courseName: string;
  notesRead: number;
  /** True when cards were written from raw material rather than digest notes. */
  fromRawMaterial?: boolean;
  cardsWritten: number;
  cardsUpdated: number;
  skipped: number;
  error?: string;
}

export interface GenerateCardsOptions {
  courseId: string;
  /** Rewrite cards for notes that already have them. */
  force?: boolean;
  /** How many nights of notes to look back over. */
  lookbackDays?: number;
}

const DEFAULT_LOOKBACK_DAYS = 30;

export async function generateFlashcards({
  courseId,
  force = false,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
}: GenerateCardsOptions): Promise<GenerateCardsResult> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });

  if (!course) {
    return {
      courseName: "unknown",
      notesRead: 0,
      cardsWritten: 0,
      cardsUpdated: 0,
      skipped: 0,
      error: "That class no longer exists.",
    };
  }

  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  since.setHours(0, 0, 0, 0);

  const notes = await prisma.lessonNote.findMany({
    where: { courseId, date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      keyPoints: true,
      _count: { select: { flashcards: true } },
    },
  });

  let cardsWritten = 0;
  let cardsUpdated = 0;
  let skipped = 0;
  let notesRead = 0;

  for (const note of notes) {
    if (note.keyPoints.length === 0) {
      skipped += 1;
      continue;
    }

    // Already carded and nothing has been asked to change — don't pay for it
    // again. Same rule the digest uses for notes it has already written.
    if (note._count.flashcards > 0 && !force) {
      skipped += 1;
      continue;
    }

    notesRead += 1;

    const result = await generateJson({
      schemaName: "flashcards",
      schema: CardSchema,
      system: SYSTEM_PROMPT,
      prompt: [
        `Class: ${course.name}`,
        `Lesson date: ${note.date.toISOString().slice(0, 10)}`,
        "",
        "Note points:",
        ...note.keyPoints.map((point, index) => `${index}. ${point}`),
      ].join("\n"),
      // Cheaper than the digest deliberately: the hard work — deciding what
      // mattered in the lesson — already happened when the note was written.
      // This is a rephrasing job.
      quality: "fast",
      maxOutputTokens: 4000,
    });

    // Several cards may come from one point; the ordinal keeps their signatures
    // distinct while staying stable across regeneration.
    const ordinals = new Map<number, number>();

    for (const card of result.data.cards) {
      if (card.sourceIndex >= note.keyPoints.length) continue;

      const front = card.front.trim();
      const back = card.back.trim();
      if (!front || !back) continue;

      const ordinal = ordinals.get(card.sourceIndex) ?? 0;
      ordinals.set(card.sourceIndex, ordinal + 1);

      const signature = signatureFor(note.id, card.sourceIndex, ordinal);

      const existing = await prisma.flashcard.findUnique({
        where: { signature },
        select: { id: true },
      });

      await prisma.flashcard.upsert({
        where: { signature },
        create: {
          courseId,
          lessonNoteId: note.id,
          front,
          back,
          hint: card.hint?.trim() || null,
          signature,
          provider: result.provider,
          model: result.model,
        },
        // Deliberately does not touch dueAt, intervalDays, easeFactor,
        // repetitions or lapses: rewording a question must not throw away a
        // month of review history for it.
        update: {
          front,
          back,
          hint: card.hint?.trim() || null,
          lessonNoteId: note.id,
          provider: result.provider,
          model: result.model,
        },
      });

      if (existing) cardsUpdated += 1;
      else cardsWritten += 1;
    }
  }

  /*
   * Nothing distilled yet — read the raw material instead.
   *
   * The chain was Canvas material → DigestSource → LessonNote → Flashcard, and
   * a student on day one has nothing past the first step. Pressing "make cards"
   * did nothing at all, silently, because the query above found no notes. That
   * is the correct behaviour for a deck that is up to date and the wrong one
   * for a deck that has never existed.
   *
   * So: when there are no notes, cards come straight from the source text the
   * ingest already collected — the teacher's coursework page, a Canvas page, an
   * uploaded textbook scan. One model call instead of two, and it works the
   * first time it is pressed rather than after a week of digests.
   */
  if (notes.length === 0 && cardsWritten === 0) {
    const raw = await generateFromRawMaterial(course, force);
    return { ...raw, courseName: course.name };
  }

  return {
    courseName: course.name,
    notesRead,
    cardsWritten,
    cardsUpdated,
    skipped,
  };
}

/** Source text worth reading, newest first. Bounded to one sane prompt. */
const MAX_RAW_CHARS = 20_000;
const MAX_RAW_SOURCES = 6;

/**
 * Read this class's Canvas pages directly.
 *
 * The last resort, and the one that makes a fresh install work: the stored
 * sources are title-only stubs on day one, so there is nothing to read until a
 * teacher posts something new. Fetching the pages now costs a few HTTP requests
 * and no model tokens, and a class's pages are exactly the material a student
 * would revise from.
 *
 * Ids are synthetic (`page:<url>`), which is fine — they only ever feed the
 * batch signature, and a page's url is as stable as a digest source's id.
 */
async function fetchCoursePages(
  courseId: string,
): Promise<{ id: string; label: string; rawText: string }[]> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { canvasId: true },
  });

  if (!course?.canvasId) return [];

  const config = await getCanvasConfig();
  if (!hasApiCredentials(config)) return [];

  const client = new CanvasClient({
    baseUrl: config.baseUrl!,
    token: config.token!,
  });

  const out: { id: string; label: string; rawText: string }[] = [];

  for (const page of (await client.getPages(course.canvasId)).slice(
    0,
    MAX_RAW_SOURCES,
  )) {
    const full = await client.getPage(course.canvasId, page.url);
    if (!full?.body) continue;

    const text = htmlToText(full.body).trim();
    // A page that is one line of navigation is not revision material.
    if (text.length < 200) continue;

    out.push({ id: `page:${page.url}`, label: page.title, rawText: text });
  }

  return out;
}

async function generateFromRawMaterial(
  course: { id: string; name: string },
  force: boolean,
): Promise<Omit<GenerateCardsResult, "courseName">> {
  /*
   * Real text only.
   *
   * The module ingest records everything already in Canvas the first time it
   * scans a course, deliberately with no body — those rows exist to say "this
   * was here before we started watching", not to be read. On a fresh install
   * that is *every* source: 37 of them here, all reading "New ExternalUrl added
   * to Canvas: X (no readable body)". Handing those to the model would spend a
   * call to produce cards about the existence of hyperlinks.
   */
  const collected = await prisma.digestSource.findMany({
    where: {
      courseId: course.id,
      NOT: { rawText: { contains: "(no readable body)" } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_RAW_SOURCES,
    select: { id: true, label: true, rawText: true },
  });

  // Nothing readable stored — go and read the class's Canvas pages now.
  const sources =
    collected.length > 0 ? collected : await fetchCoursePages(course.id);

  if (sources.length === 0) {
    return {
      notesRead: 0,
      cardsWritten: 0,
      cardsUpdated: 0,
      skipped: 0,
      fromRawMaterial: true,
      error:
        "Nothing readable in this class yet — Canvas has no page content for it. Add textbook pages, or write a card yourself.",
    };
  }

  // One call over the whole batch rather than one per source: the material is
  // short and the model needs to see it together to avoid asking the same
  // question twice from two pages of the same unit.
  const batchId = sources.map((source) => source.id).join("|");

  /*
   * Has this exact material already been read?
   *
   * The batch id is the set of source ids, so identical material produces an
   * identical first signature. Checking that one row is precise — an earlier
   * draft counted every card on the course, which also counted the ones the
   * student wrote by hand and would have refused to generate anything for a
   * class they had touched.
   */
  const alreadyRead = await prisma.flashcard.findUnique({
    where: { signature: rawSignature(batchId, 0) },
    select: { id: true },
  });

  if (alreadyRead && !force) {
    return {
      notesRead: 0,
      cardsWritten: 0,
      cardsUpdated: 0,
      skipped: sources.length,
      fromRawMaterial: true,
    };
  }

  let used = 0;
  const blocks: string[] = [];

  for (const source of sources) {
    const text = source.rawText.trim();
    if (!text) continue;
    if (used + text.length > MAX_RAW_CHARS) break;

    used += text.length;
    blocks.push(`--- ${source.label} ---\n${text}`);
  }

  if (blocks.length === 0) {
    return {
      notesRead: 0,
      cardsWritten: 0,
      cardsUpdated: 0,
      skipped: sources.length,
      fromRawMaterial: true,
      error: "The material collected for this class had no readable text.",
    };
  }

  const result = await generateJson({
    schemaName: "flashcards_raw",
    schema: CardSchema,
    system: RAW_SYSTEM_PROMPT,
    prompt: [`Class: ${course.name}`, "", "Course material:", "", ...blocks].join(
      "\n",
    ),
    quality: "fast",
    maxOutputTokens: 4000,
  });

  let cardsWritten = 0;
  let cardsUpdated = 0;
  let ordinal = 0;

  for (const card of result.data.cards) {
    const front = card.front.trim();
    const back = card.back.trim();
    if (!front || !back) continue;

    const signature = rawSignature(batchId, ordinal);
    ordinal += 1;

    const existing = await prisma.flashcard.findUnique({
      where: { signature },
      select: { id: true },
    });

    await prisma.flashcard.upsert({
      where: { signature },
      create: {
        courseId: course.id,
        front,
        back,
        hint: card.hint?.trim() || null,
        signature,
        provider: result.provider,
        model: result.model,
      },
      // Same rule as the note path: rewording never resets review history.
      update: {
        front,
        back,
        hint: card.hint?.trim() || null,
        provider: result.provider,
        model: result.model,
      },
    });

    if (existing) cardsUpdated += 1;
    else cardsWritten += 1;
  }

  return {
    notesRead: 0,
    cardsWritten,
    cardsUpdated,
    skipped: 0,
    fromRawMaterial: true,
  };
}
