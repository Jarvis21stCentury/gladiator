"use client";

import { useActionState, useEffect, useRef } from "react";

import { createCourse, type ActionResult } from "@/app/actions";

/**
 * Add a class by hand.
 *
 * Until now every class came from a Canvas sync, which meant a student whose
 * school does not use Canvas — or who takes one class that lives outside it —
 * could not create a single class, and therefore could not add a task, since
 * every task belongs to one. The app was unusable before its first successful
 * sync.
 *
 * A class added here has no `canvasId`, which is exactly what keeps a later
 * sync from touching it.
 */
export function CourseForm() {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    createCourse,
    null,
  );
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!result?.ok) return;
    const field = nameRef.current;
    if (field) {
      field.value = "";
      field.focus();
    }
  }, [result]);

  return (
    <form action={action} className="card p-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="rubric mb-1 block">Class</span>
          <input
            ref={nameRef}
            name="name"
            required
            maxLength={80}
            placeholder="AP Biology"
            className="field"
          />
        </label>

        <label className="sm:w-40">
          <span className="rubric mb-1 block">Term</span>
          <input name="term" maxLength={40} placeholder="Fall 2026" className="field" />
        </label>

        <button type="submit" className="control" data-active="true" disabled={pending}>
          {pending ? "Adding…" : "Add class"}
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
      ) : null}
    </form>
  );
}
