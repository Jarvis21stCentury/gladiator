import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

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

export interface GenerateCardsResult {
  courseName: string;
  notesRead: number;
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

  return {
    courseName: course.name,
    notesRead,
    cardsWritten,
    cardsUpdated,
    skipped,
  };
}
