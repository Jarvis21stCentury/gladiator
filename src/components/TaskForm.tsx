"use client";

import { useActionState, useEffect, useRef } from "react";

import { createTask, type ActionResult } from "@/app/actions";

/**
 * Add a task of your own.
 *
 * Canvas knows about the work teachers set. It knows nothing about revising for
 * Friday's test, the reading you promised yourself, or the college essay — which
 * is most of what actually fills a week. This is where that goes in.
 *
 * Four fields and no more. Every extra field on a form like this is a reason not
 * to use it, and the whole value of the feature depends on it being faster to
 * add a task here than to not bother: name, class, date, and an optional time
 * that defaults to 11:59 PM the way school deadlines do.
 *
 * The task it creates is an `Assignment` with `source: MANUAL`, so it shows up
 * in the due lists, the two-week forecast and the timetable immediately — see
 * the note in `actions.ts` for why that is one table and not two.
 */
export function TaskForm({
  courses,
}: {
  courses: { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    createTask,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  /*
   * Correct the date default in the browser.
   *
   * This is a client component, so `new Date()` also runs during server render.
   * In production the server is UTC and the student is not: from late afternoon
   * onwards the server's "today" is already tomorrow, and the form would quietly
   * default every task to the wrong day. Rendering the server's guess keeps the
   * field populated without JavaScript; this replaces it with the real local
   * date the moment the component mounts.
   */
  useEffect(() => {
    const field = dateRef.current;
    if (!field || field.dataset.touched === "true") return;

    const now = new Date();
    field.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  /*
   * Clear and re-focus after a successful add, because the realistic use is
   * adding three things at once on a Sunday night. Only the title and time are
   * reset — the class and date are almost always the same for the next task,
   * and re-picking them every time is exactly the friction that stops people
   * using a form like this.
   */
  useEffect(() => {
    if (!result?.ok) return;

    const title = titleRef.current;
    if (title) {
      title.value = "";
      title.focus();
    }
  }, [result]);

  if (courses.length === 0) {
    return (
      <p className="text-[0.8125rem] text-ink-soft">
        Sync a class first — a task has to belong to one.
      </p>
    );
  }

  // The server's best guess, corrected on mount by the effect above. Present so
  // the field is never empty with JavaScript disabled.
  const today = new Date();
  const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <form ref={formRef} action={action} className="card p-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-end">
        <label className="min-w-0 flex-1">
          <span className="rubric mb-1 block">Task</span>
          <input
            ref={titleRef}
            name="title"
            required
            maxLength={160}
            placeholder="Revise unit 4"
            className="field"
          />
        </label>

        <label className="lg:w-48">
          <span className="rubric mb-1 block">Class</span>
          <select name="courseId" required className="field" defaultValue="">
            <option value="" disabled>
              Pick one
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>

        <label className="lg:w-36">
          <span className="rubric mb-1 block">Due</span>
          <input
            ref={dateRef}
            type="date"
            name="dueDate"
            required
            defaultValue={isoDate}
            // Once you have picked a date yourself, nothing overwrites it.
            onChange={(event) => {
              event.currentTarget.dataset.touched = "true";
            }}
            className="field"
          />
        </label>

        <label className="lg:w-28">
          <span className="rubric mb-1 block">Time</span>
          {/* Optional. Blank means 11:59 PM, which is what school deadlines are. */}
          <input type="time" name="dueTime" className="field" />
        </label>

        <button type="submit" className="control" data-active="true" disabled={pending}>
          {pending ? "Adding…" : "Add task"}
        </button>
      </div>

      {/*
        `role="status"` so the result is announced. Without it the only feedback
        on a keyboard-driven add is a row appearing somewhere further down the
        page, which a screen reader user has no way of noticing.
      */}
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
