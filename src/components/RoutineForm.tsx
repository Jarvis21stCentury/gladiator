"use client";

import { useActionState, useEffect, useRef } from "react";

import { addRoutineBlock, type ActionResult } from "@/app/actions";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/**
 * Add something to the weekly routine.
 *
 * Days are checkboxes rather than a single select, because the thing a student
 * actually has is "practice on Tuesday and Thursday" — entering that twice is
 * the sort of friction that gets a setup screen abandoned halfway through.
 * Monday leads the row; a week that starts on Sunday is a calendar convention,
 * not how anyone describes their own timetable.
 */
export function RoutineForm() {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    addRoutineBlock,
    null,
  );
  const labelRef = useRef<HTMLInputElement>(null);

  // Clear the name after a successful add and keep the days ticked: the next
  // thing entered is usually another activity on the same days.
  useEffect(() => {
    if (!result?.ok) return;
    const field = labelRef.current;
    if (field) {
      field.value = "";
      field.focus();
    }
  }, [result]);

  return (
    <form action={action} className="card p-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-end">
        <label className="min-w-0 flex-1">
          <span className="rubric mb-1 block">What</span>
          <input
            ref={labelRef}
            name="label"
            required
            maxLength={60}
            placeholder="Track practice"
            className="field"
          />
        </label>

        <label className="lg:w-36">
          <span className="rubric mb-1 block">Kind</span>
          <select name="kind" className="field" defaultValue="ACTIVITY">
            <option value="ACTIVITY">Activity</option>
            <option value="SCHOOL">School</option>
            <option value="PERSONAL">Personal</option>
            <option value="SLEEP">Sleep</option>
          </select>
        </label>

        <label className="lg:w-28">
          <span className="rubric mb-1 block">From</span>
          <input type="time" name="start" required className="field" />
        </label>

        <label className="lg:w-28">
          <span className="rubric mb-1 block">To</span>
          <input type="time" name="end" required className="field" />
        </label>

        <button type="submit" className="control" data-active="true" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>

      <fieldset className="mt-3">
        <legend className="rubric mb-1.5">Which days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <label
              key={day.value}
              className="cursor-pointer select-none rounded border border-rule px-2 py-1 text-[0.8125rem] has-[:checked]:border-[color:var(--accent)] has-[:checked]:bg-accent-soft has-[:checked]:text-accent"
            >
              <input
                type="checkbox"
                name="days"
                value={day.value}
                className="sr-only"
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      {result ? (
        <p
          role="status"
          className="mt-2.5 text-[0.8125rem]"
          style={{ color: result.ok ? "var(--jade)" : "var(--flare)" }}
        >
          {result.message}
        </p>
      ) : null}

      <p className="mt-2.5 text-[0.75rem] text-ink-soft">
        For sleep, put bedtime in <strong>From</strong> and wake-up in{" "}
        <strong>To</strong> — that&apos;s what bounds each day.
      </p>
    </form>
  );
}
