"use client";

import { useActionState } from "react";

import { setSchoolYear, type ActionResult } from "@/app/actions";

/**
 * The window every list is bounded by.
 *
 * Canvas keeps every course a student has ever taken, so without this the due
 * lists carry assignments from 2021 alongside tonight's homework. The defaults
 * are the district's published calendar; this exists because that is a fact
 * about one district and about one year.
 */
export function SchoolYearForm({
  start,
  end,
  configured,
}: {
  start: string;
  end: string;
  configured: boolean;
}) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    setSchoolYear,
    null,
  );

  return (
    <form action={action} className="card p-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
        <label className="sm:w-44">
          <span className="rubric mb-1 block">First day</span>
          <input type="date" name="start" defaultValue={start} required className="field" />
        </label>
        <label className="sm:w-44">
          <span className="rubric mb-1 block">Last day</span>
          <input type="date" name="end" defaultValue={end} required className="field" />
        </label>
        <button type="submit" className="control" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {result ? (
        <p
          role="status"
          className="mt-2.5 text-[0.8125rem]"
          style={{ color: result.ok ? "var(--jade)" : "var(--flare)" }}
        >
          {result.message}
        </p>
      ) : (
        <p className="mt-2.5 text-[0.75rem] text-ink-soft">
          Work due outside these dates is left out of every list, the forecast
          and the planner.
          {!configured ? " Currently using Frisco ISD's 2026–27 calendar." : ""}
        </p>
      )}
    </form>
  );
}
