"use client";

import { useActionState, useState } from "react";

import { setCourseGrade, type ActionResult } from "@/app/actions";

/**
 * Type a class's grade in.
 *
 * Grades used to arrive from Canvas and nowhere else, which is a problem for
 * the very common case of a school that keeps assignments in Canvas and grades
 * somewhere else — or a class in neither. There was no way to answer "what am I
 * actually sitting at", which is most of why anyone opens a page called Classes.
 *
 * Saving writes a snapshot for today as well as the headline number, so the
 * grade trend keeps working; see `setCourseGrade`.
 *
 * A Canvas-backed class says so, because the next sync will overwrite whatever
 * is typed here the moment Canvas has a score of its own. Better to say that
 * plainly than to let a number quietly revert overnight.
 */
export function GradeEditor({
  courseId,
  courseName,
  percent,
  fromCanvas,
}: {
  courseId: string;
  courseName: string;
  percent: number | null;
  fromCanvas: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    setCourseGrade,
    null,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[0.75rem] text-ink-soft underline underline-offset-2 hover:text-accent"
      >
        {percent === null ? "Set grade" : "Edit grade"}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      <label className="flex items-center gap-1.5">
        <span className="sr-only">{courseName} grade percent</span>
        <input
          name="percent"
          defaultValue={percent ?? ""}
          inputMode="decimal"
          placeholder="87.5"
          aria-label={`${courseName} grade percent`}
          className="field w-20"
          autoFocus
        />
        <span className="text-[0.8125rem] text-ink-soft">%</span>
      </label>

      <button type="submit" className="control" data-active="true" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="control">
        Done
      </button>

      {result ? (
        <span
          role="status"
          className="text-[0.75rem]"
          style={{ color: result.ok ? "var(--jade)" : "var(--flare)" }}
        >
          {result.message}
        </span>
      ) : (
        <span className="text-[0.75rem] text-ink-soft">
          {fromCanvas
            ? "Canvas will overwrite this once it has a score."
            : "Blank clears it."}
        </span>
      )}
    </form>
  );
}
