import { NextResponse } from "next/server";

import { SyllabusParseError, parseSyllabus } from "@/lib/syllabus/parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Syllabus upload — one pass at the start of a semester turns a PDF into due
 * dates and grade weightings.
 *
 * Same shape as the textbook upload, and the same rule about storage: the file
 * is read and discarded. What persists is the extracted `Assignment` and
 * `GradeCategory` rows, plus a `SyllabusImport` audit row saying where they
 * came from.
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

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  if (typeof courseId !== "string" || !courseId) {
    return NextResponse.json({ error: "Pick a class." }, { status: 400 });
  }

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  try {
    const result = await parseSyllabus({
      courseId,
      fileName: file.name || "syllabus",
      bytes: new Uint8Array(await file.arrayBuffer()),
      mediaType: isPdf ? "application/pdf" : file.type,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SyllabusParseError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
