import "server-only";

import { z } from "zod";

import { extractFromImage, TextbookExtractionError } from "@/lib/digest/textbook";
import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";

/**
 * The syllabus parser (FEATURES.md Tier 2): drop a PDF in at the start of a
 * semester and every due date, test date and grade weighting lands in the
 * system in one pass.
 *
 * What it writes is deliberately narrow:
 *   - `GradeCategory` rows, which are what turn the what-if calculator from a
 *     flat-points approximation into a real answer.
 *   - `Assignment` rows with `source: SYLLABUS` and a null `canvasId`, for dates
 *     printed on the syllabus that Canvas doesn't have yet.
 *
 * Canvas stays authoritative. Where a syllabus date collides with an assignment
 * Canvas already gave us, the Canvas row wins and the syllabus one is skipped —
 * a syllabus is a plan written in August, and Canvas is what actually happened.
 */

/** A syllabus is a handful of pages. Past this, something else was uploaded. */
const MAX_PDF_PAGES = 30;
const MAX_TEXT_CHARS = 60_000;

const SyllabusSchema = z.strictObject({
  categories: z.array(
    z.strictObject({
      name: z.string(),
      /** 0–100. */
      weightPercent: z.number(),
    }),
  ),
  dates: z.array(
    z.strictObject({
      title: z.string(),
      /** ISO calendar date, YYYY-MM-DD. */
      date: z.string(),
      kind: z.enum(["TEST", "PROJECT", "ASSIGNMENT", "OTHER"]),
      pointsPossible: z.number().nullable(),
      /** Must match one of the category names above, or be null. */
      categoryName: z.string().nullable(),
    }),
  ),
  warnings: z.array(z.string()),
});

const SYSTEM_PROMPT = `You extract structured data from a course syllabus.

Return three things:

1. categories — the weighted grading buckets and their percentages, exactly as the syllabus states them ("Tests 40%", "Homework 15%"). If the syllabus does not give weights, return an empty array. Never invent a weighting scheme.

2. dates — every dated item: tests, quizzes, projects, papers, presentations, and any assignment with a printed due date. Give each an ISO date (YYYY-MM-DD). Use the year printed on the syllabus; if no year appears, infer it from the term and add a warning saying you did. Skip holidays, breaks, and "no class" entries — those are not work. Skip anything whose date you cannot pin down. categoryName must be one of the category names you returned, or null.

3. warnings — anything a person should check: weights that do not total 100, a date with no year, an ambiguous entry you skipped.

Extract only what is printed. Do not add typical assignments, do not guess point values, do not fill gaps in a schedule.`;

export class SyllabusParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyllabusParseError";
  }
}

async function readPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  let text: string;
  let totalPages: number;

  try {
    const pdf = await getDocumentProxy(bytes);
    totalPages = pdf.numPages;
    const extracted = await extractText(pdf, { mergePages: false });
    text = extracted.text.slice(0, MAX_PDF_PAGES).join("\n\n");
  } catch (error) {
    throw new SyllabusParseError(
      `Could not read that PDF: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!text.trim()) {
    // Same failure mode as a scanned textbook page, and the same answer.
    throw new SyllabusParseError(
      "That PDF has no selectable text, which usually means it is a scan. Upload a photo of the syllabus instead — that route goes through the vision model.",
    );
  }

  if (totalPages > MAX_PDF_PAGES) {
    text += `\n\n[Truncated at ${MAX_PDF_PAGES} of ${totalPages} pages.]`;
  }

  return text.slice(0, MAX_TEXT_CHARS);
}

export interface ParseSyllabusOptions {
  courseId: string;
  fileName: string;
  bytes: Uint8Array;
  mediaType: string;
}

export interface ParseSyllabusResult {
  importId: string;
  courseName: string;
  categoriesWritten: number;
  datesWritten: number;
  /** Dates skipped because Canvas already has that assignment. */
  datesSkipped: number;
  warnings: string[];
}

/** End of the given calendar day, local time — a due date with no clock on it. */
function endOfDay(isoDate: string): Date | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    23,
    59,
    0,
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

export async function parseSyllabus({
  courseId,
  fileName,
  bytes,
  mediaType,
}: ParseSyllabusOptions): Promise<ParseSyllabusResult> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });

  if (!course) {
    throw new SyllabusParseError("That class no longer exists.");
  }

  let text: string;

  if (mediaType === "application/pdf") {
    text = await readPdfText(bytes);
  } else if (mediaType.startsWith("image/")) {
    try {
      const extracted = await extractFromImage(bytes, mediaType);
      text = extracted.text;
    } catch (error) {
      if (error instanceof TextbookExtractionError) {
        throw new SyllabusParseError(error.message);
      }
      throw error;
    }
  } else {
    throw new SyllabusParseError(
      `Unsupported file type "${mediaType}". Upload a PDF or a photo of the syllabus.`,
    );
  }

  const result = await generateJson({
    schemaName: "syllabus",
    schema: SyllabusSchema,
    system: SYSTEM_PROMPT,
    prompt: `Course: ${course.name}\nFile: ${fileName}\n\n---\n\n${text}`,
    // Extraction is structured work, not writing — the cheap model per
    // ARCHITECTURE.md. A syllabus is long, so give the output real headroom.
    quality: "fast",
    maxOutputTokens: 8000,
  });

  const warnings = [...result.data.warnings];

  // --- Categories ---------------------------------------------------------

  const categoryIdByName = new Map<string, string>();
  let categoriesWritten = 0;

  const weightTotal = result.data.categories.reduce(
    (sum, category) => sum + category.weightPercent,
    0,
  );

  if (result.data.categories.length > 0 && Math.abs(weightTotal - 100) > 1) {
    warnings.push(
      `The grading weights add up to ${weightTotal.toFixed(0)}%, not 100%. They are stored as printed and normalised when calculating.`,
    );
  }

  for (const category of result.data.categories) {
    const name = category.name.trim();
    if (!name || category.weightPercent <= 0) continue;

    const record = await prisma.gradeCategory.upsert({
      where: { courseId_name: { courseId, name } },
      create: {
        courseId,
        name,
        weightPercent: category.weightPercent,
        source: "SYLLABUS",
      },
      update: { weightPercent: category.weightPercent, source: "SYLLABUS" },
    });

    categoryIdByName.set(name.toLowerCase(), record.id);
    categoriesWritten += 1;
  }

  // --- Dates --------------------------------------------------------------

  // Everything already on record for this class, so a re-parse updates its own
  // rows instead of duplicating them and never overwrites a Canvas row.
  const existing = await prisma.assignment.findMany({
    where: { courseId },
    select: { id: true, title: true, source: true },
  });

  const existingByTitle = new Map(
    existing.map((assignment) => [assignment.title.trim().toLowerCase(), assignment]),
  );

  let datesWritten = 0;
  let datesSkipped = 0;

  for (const item of result.data.dates) {
    const title = item.title.trim();
    const dueAt = endOfDay(item.date);

    if (!title || !dueAt) {
      datesSkipped += 1;
      continue;
    }

    const prior = existingByTitle.get(title.toLowerCase());
    const gradeCategoryId = item.categoryName
      ? (categoryIdByName.get(item.categoryName.trim().toLowerCase()) ?? null)
      : null;

    if (prior && prior.source === "CANVAS") {
      // Canvas has it. Attach the category — that is information the syllabus
      // has and Canvas doesn't — but leave the date and title alone.
      if (gradeCategoryId) {
        await prisma.assignment.update({
          where: { id: prior.id },
          data: { gradeCategoryId },
        });
      }
      datesSkipped += 1;
      continue;
    }

    if (prior) {
      await prisma.assignment.update({
        where: { id: prior.id },
        data: { dueAt, gradeCategoryId, pointsPossible: item.pointsPossible },
      });
    } else {
      await prisma.assignment.create({
        data: {
          courseId,
          title,
          dueAt,
          pointsPossible: item.pointsPossible,
          gradeCategoryId,
          source: "SYLLABUS",
          canvasId: null,
        },
      });
    }

    datesWritten += 1;
  }

  const record = await prisma.syllabusImport.create({
    data: {
      courseId,
      fileName,
      datesFound: datesWritten,
      categoriesFound: categoriesWritten,
      warnings,
      provider: result.provider,
      model: result.model,
    },
  });

  return {
    importId: record.id,
    courseName: course.name,
    categoriesWritten,
    datesWritten,
    datesSkipped,
    warnings,
  };
}
