import { NextResponse } from "next/server";

import { schoolDay } from "@/lib/digest/day";
import {
  TextbookExtractionError,
  extractFromImage,
  extractFromPdf,
  saveTextbookSource,
} from "@/lib/digest/textbook";
import { prisma } from "@/lib/prisma";
import { DigestSourceKind } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Textbook page upload. Takes an image (read by a vision model) or a PDF plus a
 * page range (read straight from the text layer). Only the extracted text is
 * kept — the uploaded file is never written to storage.
 */
export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const courseId = form.get("courseId");
  const pageRange = form.get("pageRange");
  const dateValue = form.get("date");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  if (typeof courseId !== "string" || !courseId) {
    return NextResponse.json({ error: "Pick a class." }, { status: 400 });
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });

  if (!course) {
    return NextResponse.json({ error: "Unknown class." }, { status: 400 });
  }

  const date =
    typeof dateValue === "string" && dateValue
      ? new Date(`${dateValue}T12:00:00`)
      : new Date();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    let text: string;
    let warnings: string[];
    let kind: DigestSourceKind;
    let label: string;

    if (isPdf) {
      if (typeof pageRange !== "string" || !pageRange.trim()) {
        return NextResponse.json(
          {
            error:
              "Give a page range for a PDF, like 40-52 — otherwise the whole book gets read.",
          },
          { status: 400 },
        );
      }

      const extracted = await extractFromPdf(bytes, pageRange);
      text = extracted.text;
      warnings = extracted.warnings;
      kind = DigestSourceKind.TEXTBOOK_PDF;
      label = `${file.name} p.${pageRange.trim()}`;
    } else {
      const extracted = await extractFromImage(bytes, file.type);
      text = extracted.text;
      warnings = extracted.warnings;
      kind = DigestSourceKind.TEXTBOOK_IMAGE;
      label = file.name || "textbook photo";
    }

    const source = await saveTextbookSource({
      courseId: course.id,
      label,
      text,
      kind,
      date,
    });

    return NextResponse.json({
      sourceId: source.id,
      courseName: course.name,
      date: schoolDay(date).toISOString().slice(0, 10),
      label,
      characters: text.length,
      preview: text.slice(0, 240),
      warnings,
    });
  } catch (error) {
    if (error instanceof TextbookExtractionError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
