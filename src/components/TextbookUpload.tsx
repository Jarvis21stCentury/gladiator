"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface CourseOption {
  id: string;
  name: string;
}

interface TextbookUploadProps {
  courses: CourseOption[];
  /** `YYYY-MM-DD` the upload should be filed under. */
  date: string;
}

interface UploadOutcome {
  ok: boolean;
  message: string;
  warnings?: string[];
  preview?: string;
}

/**
 * Textbook page intake. A photo goes to the vision model; a PDF needs a page
 * range and is read straight from its text layer.
 */
export function TextbookUpload({ courses, date }: TextbookUploadProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isPdf, setIsPdf] = useState(false);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    setBusy(true);
    setOutcome(null);

    try {
      const response = await fetch("/api/digest/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const body = await response.json();

      if (!response.ok) {
        setOutcome({ ok: false, message: body.error ?? "Upload failed." });
        return;
      }

      setOutcome({
        ok: true,
        message: `Read ${body.characters} characters from ${body.label} for ${body.courseName}.`,
        warnings: body.warnings,
        preview: body.preview,
      });
      form.reset();
      setIsPdf(false);
      router.refresh();
    } catch (error) {
      setOutcome({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  if (courses.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        Sync Canvas first — there are no classes to file pages under.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="date" value={date} />

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="rubric">Class</span>
          <select
            id="upload-course"
            name="courseId"
            required
            className="field"
          >
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="rubric">Page photo or PDF</span>
          <input
            id="upload-file"
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            required
            className="field file:mr-3 file:border-0 file:bg-transparent file:text-ink-soft"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              setIsPdf(
                Boolean(
                  file &&
                    (file.type === "application/pdf" ||
                      file.name.toLowerCase().endsWith(".pdf")),
                ),
              );
            }}
          />
        </label>

        {isPdf ? (
          <label className="flex flex-col gap-1.5">
            <span className="rubric">Pages — required for PDFs</span>
            <input
              id="upload-pages"
              type="text"
              name="pageRange"
              placeholder="40-52"
              required
              className="field w-28"
            />
          </label>
        ) : null}

        <button type="submit" disabled={busy} className="control">
          {busy ? "Reading the page…" : "Add pages"}
        </button>
      </div>

      {outcome ? (
        <div
          className="border-l-2 pl-4"
          style={{
            borderColor: outcome.ok
              ? "var(--jade)"
              : "var(--flare)",
          }}
        >
          <p className="text-sm">
            {outcome.ok
              ? outcome.message
              : `Couldn't add that: ${outcome.message}`}
          </p>
          {outcome.warnings?.map((warning) => (
            <p key={warning} className="mt-1 text-xs text-amber">
              {warning}
            </p>
          ))}
          {outcome.preview ? (
            <p className="mt-2 text-xs italic text-ink-soft">
              Starts: {outcome.preview}…
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
