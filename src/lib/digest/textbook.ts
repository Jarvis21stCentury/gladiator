import "server-only";

import { z } from "zod";

import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { DigestSourceKind } from "@/generated/prisma/enums";
import { schoolDay } from "./day";

/**
 * Getting textbook pages in. FEATURES.md offers two routes and this supports
 * both: a photo (a vision-capable model reads it) or a saved PDF page range
 * (text layer read directly, no OCR).
 *
 * Either way only the extracted text is kept — the file itself is discarded once
 * read. The user is meant to read the distilled notes, not the original pages.
 */

export class TextbookExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextbookExtractionError";
  }
}

const PageTextSchema = z.strictObject({
  /** Verbatim text of the page(s), lightly cleaned. */
  text: z.string(),
  /** True when the image is too blurry/dark/cropped to read reliably. */
  unreadable: z.boolean(),
});

const VISION_SYSTEM = `You transcribe photographed textbook pages.

Return the page's text as faithfully as you can. Preserve headings, bold key terms as plain text, numbered/bulleted lists, and the reading order. Skip page furniture — running heads, page numbers, and decorative captions that carry no content. Describe a diagram in one short bracketed line only if it carries information the surrounding text does not.

Do not summarise, explain, or add anything that is not on the page. If the image is too blurry, dark, or cropped to read with confidence, set unreadable to true and return whatever text you could make out.`;

/** Vision models cap image size; well under any provider limit. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface ExtractionResult {
  text: string;
  /** Warnings worth surfacing to the user (blurry photo, empty pages). */
  warnings: string[];
}

/** Read a photographed page with a vision-capable model. */
export async function extractFromImage(
  bytes: Uint8Array,
  mediaType: string,
): Promise<ExtractionResult> {
  if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) {
    throw new TextbookExtractionError(
      `Unsupported image type "${mediaType}". Use JPEG, PNG, GIF or WebP.`,
    );
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new TextbookExtractionError(
      `Image is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`,
    );
  }

  const result = await generateJson({
    schemaName: "page_text",
    schema: PageTextSchema,
    system: VISION_SYSTEM,
    prompt:
      "Transcribe this textbook page. Return only what is printed on it.",
    images: [
      { mediaType, base64: Buffer.from(bytes).toString("base64") },
    ],
    // ARCHITECTURE.md: transcription is routine structured work, not writing —
    // the strong model is reserved for the digest prose itself.
    quality: "fast",
    maxOutputTokens: 8000,
  });

  const warnings: string[] = [];
  if (result.data.unreadable) {
    warnings.push(
      "The photo was hard to read — check the notes against the page, or retake it in better light.",
    );
  }

  if (!result.data.text.trim()) {
    throw new TextbookExtractionError(
      "No text could be read from that image. Retake the photo straight-on in good light.",
    );
  }

  return { text: result.data.text, warnings };
}

/** Inclusive 1-based page range, e.g. "40-52" or "17". */
export function parsePageRange(
  raw: string,
): { from: number; to: number } {
  const trimmed = raw.trim();
  const single = trimmed.match(/^(\d+)$/);
  if (single) {
    const page = Number(single[1]);
    return { from: page, to: page };
  }

  const range = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!range) {
    throw new TextbookExtractionError(
      `Could not read the page range "${raw}". Use a number or a range like 40-52.`,
    );
  }

  const from = Number(range[1]);
  const to = Number(range[2]);

  if (from > to) {
    throw new TextbookExtractionError(
      `Page range "${raw}" starts after it ends.`,
    );
  }

  return { from, to };
}

/**
 * Read a page range out of a PDF's text layer. No model call — FEATURES.md notes
 * this route "skips OCR", which is the whole reason to prefer it over a photo.
 */
export async function extractFromPdf(
  bytes: Uint8Array,
  pageRange: string,
): Promise<ExtractionResult> {
  const { from, to } = parsePageRange(pageRange);
  const { extractText, getDocumentProxy } = await import("unpdf");

  let pages: string[];
  let totalPages: number;

  try {
    const pdf = await getDocumentProxy(bytes);
    totalPages = pdf.numPages;
    const extracted = await extractText(pdf, { mergePages: false });
    pages = extracted.text;
  } catch (error) {
    throw new TextbookExtractionError(
      `Could not read that PDF: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (from > totalPages) {
    throw new TextbookExtractionError(
      `That PDF has ${totalPages} page(s); page ${from} doesn't exist.`,
    );
  }

  const warnings: string[] = [];
  const lastPage = Math.min(to, totalPages);

  if (to > totalPages) {
    warnings.push(
      `Asked for pages up to ${to} but the PDF ends at ${totalPages}; read ${from}–${totalPages}.`,
    );
  }

  const selected = pages
    .slice(from - 1, lastPage)
    .map((text, index) => `[p.${from + index}]\n${text.trim()}`)
    .filter((block) => block.split("\n").slice(1).join("").trim().length > 0);

  if (selected.length === 0) {
    // Scanned textbooks are images in a PDF wrapper — there is no text layer to
    // read, and this app doesn't rasterise. The photo route handles those.
    throw new TextbookExtractionError(
      `No selectable text on page(s) ${from}–${lastPage}. That usually means the PDF is a scan — upload a photo of the page instead, which goes through the vision model.`,
    );
  }

  return { text: selected.join("\n\n"), warnings };
}

export interface SaveTextbookOptions {
  courseId: string;
  label: string;
  text: string;
  kind: DigestSourceKind;
  date?: Date;
}

export async function saveTextbookSource({
  courseId,
  label,
  text,
  kind,
  date,
}: SaveTextbookOptions) {
  return prisma.digestSource.create({
    data: {
      date: schoolDay(date),
      courseId,
      kind,
      label,
      rawText: text,
    },
  });
}
