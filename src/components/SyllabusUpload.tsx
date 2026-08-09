"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Syllabus intake for one class. A PDF is read from its text layer; a photo
 * goes through the vision model.
 *
 * Scoped to a single class rather than offering a picker, because it is
 * rendered inside that class's dossier — the context is already established, and
 * a dropdown there is one more thing to get wrong.
 */
export function SyllabusUpload({
  courseId,
  courseName,
}: {
  courseId: string;
  courseName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{
    ok: boolean;
    message: string;
    warnings?: string[];
  } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    setBusy(true);
    setOutcome(null);

    try {
      const response = await fetch("/api/syllabus/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const body = await response.json();

      if (!response.ok) {
        setOutcome({ ok: false, message: body.error ?? "Parse failed." });
        return;
      }

      setOutcome({
        ok: true,
        message: `${body.datesWritten} date(s) and ${body.categoriesWritten} grading categor${
          body.categoriesWritten === 1 ? "y" : "ies"
        } added to ${body.courseName}${
          body.datesSkipped > 0
            ? `. ${body.datesSkipped} left alone — Canvas already has them.`
            : "."
        }`,
        warnings: body.warnings,
      });
      form.reset();
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="hidden" name="courseId" value={courseId} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="rubric">{courseName} syllabus</span>
          <input
            type="file"
            name="file"
            accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
            required
            className="field file:mr-3 file:border-0 file:bg-transparent file:text-ink-soft"
          />
        </label>

        <button type="submit" disabled={busy} className="control">
          {busy ? "Parsing…" : "Parse syllabus"}
        </button>
      </div>

      <p className="docket">
        Extracts every printed test and due date plus the grade weightings.
        Canvas stays authoritative — anything it already has is left alone. The
        file itself is not stored.
      </p>

      {outcome ? (
        <div
          className="border-l-2 pl-4"
          style={{
            borderColor: outcome.ok
              ? "var(--jade)"
              : "var(--flare)",
          }}
        >
          <p className="text-sm">{outcome.message}</p>
          {outcome.warnings?.map((warning) => (
            <p key={warning} className="mt-1 text-xs text-amber">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
    </form>
  );
}
