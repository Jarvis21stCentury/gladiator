"use client";

import { useActionState } from "react";

import { logEffort, type ActionResult } from "@/app/actions";

/**
 * The input side of the effort calibration engine: after finishing something,
 * log how long it actually took.
 *
 * Kept to three fields, one of them optional, because this is a form the user
 * has to fill in *after* they have just finished their homework. Anything more
 * elaborate and it stops getting filled in, and an empty EffortLog table means
 * the planner is guessing forever.
 */
export function EffortLogForm({
  assignments,
}: {
  assignments: { id: string; title: string; estimatedMinutes: number }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    logEffort,
    null,
  );

  if (assignments.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        Nothing to log yet — this appears once there is recent work in this class.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="rubric">Assignment</span>
          <select name="assignmentId" required className="field max-w-xs">
            {assignments.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="rubric">Actual min</span>
          <input
            type="number"
            name="actualMinutes"
            min={1}
            max={1440}
            required
            className="field w-24"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="rubric">You expected</span>
          <input
            type="number"
            name="estimatedMinutes"
            min={1}
            max={1440}
            placeholder="optional"
            className="field w-28"
          />
        </label>

        <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <span className="rubric">Note</span>
          <input
            type="text"
            name="note"
            placeholder="optional — what made it slow?"
            className="field"
          />
        </label>

        <button type="submit" disabled={pending} className="control">
          {pending ? "Logging…" : "Log time"}
        </button>
      </div>

      <p className="docket">
        Filling in what you expected is what teaches the planner your pace — with
        a few of those it stops using the generic heuristic for this class.
      </p>

      {state ? (
        <p
          className="text-sm"
          style={{
            color: state.ok
              ? "var(--moss)"
              : "var(--vermilion)",
          }}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
