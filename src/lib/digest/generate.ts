import "server-only";

import { z } from "zod";

import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import {
  DigestSourceKind,
  LessonNoteSourceType,
} from "@/generated/prisma/enums";
import { schoolDay } from "./day";

/**
 * The nightly distillation. FEATURES.md: everything covered today, per class,
 * turned into short key-point notes — "replaces highlighting entirely", so the
 * points have to be good enough to study from on their own.
 */

const NoteSchema = z.strictObject({
  /**
   * Self-contained study points. FEATURES.md says these later become flashcards,
   * so each must stand alone without the surrounding prose.
   */
  keyPoints: z.array(z.string()),
  /** Two or three sentences framing the day for this class. */
  summary: z.string(),
});

const SYSTEM_PROMPT = `You distil one school day's material for a single class into study notes.

The student reads your notes instead of re-reading the source material, so the notes have to carry the content, not point at it.

keyPoints:
- One idea per point, stated in full. Each will later become a flashcard on its own, so it must make sense with no other context — never "the three types listed above" or "this process".
- Include the specifics worth remembering: definitions, mechanisms, causes, dates, formulas, worked relationships. Keep concrete numbers and named terms.
- Write plainly and briefly. A point is one or two sentences, not a paragraph.
- Cover the material given; don't pad to hit a count, and don't invent anything that isn't in the source. If a source only says something was posted, note that it was posted rather than guessing its contents.
- Order them the way the material was taught.

summary: two or three sentences telling the student what this class covered today and what matters most. Plain language, no preamble, no headers.

Never add facts that are not in the supplied material.`;

/** Keep one class's material within a sane prompt size. */
const MAX_CHARS_PER_SOURCE = 12_000;
const MAX_CHARS_PER_CLASS = 40_000;

function sourceLabel(kind: DigestSourceKind): string {
  return {
    CANVAS_MODULE_ITEM: "Canvas module",
    CANVAS_ANNOUNCEMENT: "Announcement",
    TEXTBOOK_IMAGE: "Textbook page (photo)",
    TEXTBOOK_PDF: "Textbook pages (PDF)",
  }[kind];
}

function resolveSourceType(kinds: DigestSourceKind[]): LessonNoteSourceType {
  const hasCanvas = kinds.some(
    (kind) =>
      kind === DigestSourceKind.CANVAS_MODULE_ITEM ||
      kind === DigestSourceKind.CANVAS_ANNOUNCEMENT,
  );
  const hasTextbook = kinds.some(
    (kind) =>
      kind === DigestSourceKind.TEXTBOOK_IMAGE ||
      kind === DigestSourceKind.TEXTBOOK_PDF,
  );

  if (hasCanvas && hasTextbook) return LessonNoteSourceType.MIXED;
  return hasTextbook
    ? LessonNoteSourceType.TEXTBOOK
    : LessonNoteSourceType.CANVAS;
}

export interface DigestClassResult {
  courseName: string;
  status: "written" | "skipped" | "failed";
  keyPointCount?: number;
  sourceCount?: number;
  error?: string;
}

export interface DigestResult {
  date: Date;
  classes: DigestClassResult[];
  notesWritten: number;
  /** True when a time budget stopped the run before every class was done. */
  incomplete: boolean;
}

export interface GenerateDigestOptions {
  /** An already-normalised school day — see `schoolDay`. Defaults to today. */
  day?: Date;
  /** Regenerate classes that already have a note for the day. */
  force?: boolean;
  /**
   * Stop starting new classes after this many ms. Lets the evening cron do what
   * it can inside Hobby's 60s function ceiling instead of dying mid-run.
   */
  budgetMs?: number;
}

export async function generateDigest({
  day = schoolDay(),
  force = false,
  budgetMs,
}: GenerateDigestOptions = {}): Promise<DigestResult> {
  const startedAt = Date.now();

  const sources = await prisma.digestSource.findMany({
    where: { date: day, includeInDigest: true },
    orderBy: { createdAt: "asc" },
    include: { course: { select: { id: true, name: true } } },
  });

  const byCourse = new Map<string, typeof sources>();
  for (const source of sources) {
    const bucket = byCourse.get(source.courseId) ?? [];
    bucket.push(source);
    byCourse.set(source.courseId, bucket);
  }

  const classes: DigestClassResult[] = [];
  let notesWritten = 0;
  let incomplete = false;

  for (const [courseId, courseSources] of byCourse) {
    const courseName = courseSources[0].course.name;

    if (budgetMs !== undefined && Date.now() - startedAt > budgetMs) {
      incomplete = true;
      classes.push({ courseName, status: "skipped", error: "Ran out of time." });
      continue;
    }

    const existing = await prisma.lessonNote.findUnique({
      where: { courseId_date: { courseId, date: day } },
      select: { id: true, sources: { select: { id: true } } },
    });

    // Already written and nothing new has arrived since — leave it alone.
    if (existing && !force) {
      const alreadyUsed = new Set(existing.sources.map((s) => s.id));
      const hasNewMaterial = courseSources.some(
        (source) => !alreadyUsed.has(source.id),
      );

      if (!hasNewMaterial) {
        classes.push({ courseName, status: "skipped" });
        continue;
      }
    }

    let used = 0;
    const blocks: string[] = [];

    for (const source of courseSources) {
      const text = source.rawText.slice(0, MAX_CHARS_PER_SOURCE);
      if (used + text.length > MAX_CHARS_PER_CLASS) break;

      used += text.length;
      blocks.push(
        `--- ${sourceLabel(source.kind)}: ${source.label} ---\n${text}`,
      );
    }

    try {
      const result = await generateJson({
        schemaName: "lesson_note",
        schema: NoteSchema,
        system: SYSTEM_PROMPT,
        prompt: [
          `Class: ${courseName}`,
          `Date: ${day.toISOString().slice(0, 10)}`,
          "",
          "Material covered today:",
          "",
          blocks.join("\n\n"),
        ].join("\n"),
        // ARCHITECTURE.md names the nightly digest summary as a place where
        // writing quality actually matters.
        quality: "strong",
        maxOutputTokens: 6000,
      });

      const keyPoints = result.data.keyPoints
        .map((point) => point.trim())
        .filter(Boolean);

      const note = await prisma.$transaction(async (tx) => {
        const record = await tx.lessonNote.upsert({
          where: { courseId_date: { courseId, date: day } },
          create: {
            date: day,
            courseId,
            sourceType: resolveSourceType(courseSources.map((s) => s.kind)),
            rawInputRef: courseSources.map((s) => s.label).join(" | "),
            keyPoints,
            generatedSummary: result.data.summary,
            provider: result.provider,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
          update: {
            sourceType: resolveSourceType(courseSources.map((s) => s.kind)),
            rawInputRef: courseSources.map((s) => s.label).join(" | "),
            keyPoints,
            generatedSummary: result.data.summary,
            provider: result.provider,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
        });

        // Record which material this note was built from, so a later upload is
        // recognised as new and triggers a regeneration.
        await tx.digestSource.updateMany({
          where: { id: { in: courseSources.map((s) => s.id) } },
          data: { lessonNoteId: record.id },
        });

        return record;
      });

      notesWritten += 1;
      classes.push({
        courseName,
        status: "written",
        keyPointCount: note.keyPoints.length,
        sourceCount: blocks.length,
      });
    } catch (error) {
      // One class failing shouldn't cost the other four.
      classes.push({
        courseName,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { date: day, classes, notesWritten, incomplete };
}

/**
 * Everything needed to render the digest page for one day. `day` must already be
 * a normalised school day — see `schoolDay`.
 */
export async function getDigestForDay(day: Date) {
  const [notes, pendingSources, courses] = await Promise.all([
    prisma.lessonNote.findMany({
      where: { date: day },
      include: {
        course: { select: { name: true } },
        sources: { select: { id: true, label: true, kind: true } },
      },
      orderBy: { course: { name: "asc" } },
    }),
    prisma.digestSource.findMany({
      where: { date: day, includeInDigest: true, lessonNoteId: null },
      include: { course: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.course.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { date: day, notes, pendingSources, courses };
}
