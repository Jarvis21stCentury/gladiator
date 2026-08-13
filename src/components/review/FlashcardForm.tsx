"use client";

import { useActionState, useRef, useState } from "react";

import { createFlashcard, type ActionResult } from "@/app/actions";

/**
 * Write a flashcard yourself.
 *
 * The only part of studying that works with no API key, and for a while the
 * only part with no visible entry point at all: cards were generated from
 * digest notes, so with zero notes the "Make cards" button rendered nowhere and
 * there was genuinely nowhere in the product to make a flashcard.
 *
 * Stays open after a save and clears the fields, because cards are written in
 * batches — closing after each one would make writing ten of them ten trips.
 */
export function FlashcardForm({
  courses,
  courseId,
}: {
  courses: { id: string; name: string }[];
  /** Fixed class, when the form sits inside one. Hides the picker. */
  courseId?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    async (previous, formData) => {
      const outcome = await createFlashcard(previous, formData);
      // Only the sides are cleared — the class stays selected, which is what
      // makes writing a run of cards for one subject bearable.
      if (outcome.ok) {
        const form = formRef.current;
        form?.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
          "[data-clear]",
        ).forEach((field) => {
          field.value = "";
        });
      }
      return outcome;
    },
    null,
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="control">
        Write a card
      </button>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      {courseId ? (
        <input type="hidden" name="courseId" value={courseId} />
      ) : (
        <label className="flex flex-col gap-1">
          <span className="rubric">Class</span>
          <select name="courseId" className="field" required defaultValue="">
            <option value="" disabled>
              Pick a class
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="rubric">Question</span>
        <textarea
          name="front"
          data-clear=""
          rows={2}
          required
          className="field"
          placeholder="What does the second derivative tell you?"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="rubric">Answer</span>
        <textarea
          name="back"
          data-clear=""
          rows={2}
          required
          className="field"
          placeholder="Concavity — where it's positive the curve bends upward."
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="rubric">Hint — optional</span>
        <input
          name="hint"
          data-clear=""
          className="field"
          placeholder="Unit 3, notes p.4"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="control"
          data-active="true"
          disabled={pending}
        >
          {pending ? "Saving…" : "Add card"}
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
            New cards come up in your next sitting.
          </span>
        )}
      </div>
    </form>
  );
}
