"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { setAssignmentDifficulty } from "@/app/actions";
import { DIFFICULTY_LABEL } from "@/lib/effort/difficulty";

/**
 * Rate how hard a piece of work is.
 *
 * Opens on **double-click anywhere on the row**, which is the fast path once you
 * know it exists, and on clicking the little rating badge, which is how you find
 * out it exists at all. A double-click-only affordance is invisible and
 * unreachable from a keyboard; a visible control that also responds to
 * double-click costs one small badge and works for everyone.
 *
 * The rating drives effort estimation, so it changes how much of an evening the
 * planner sets aside for this — see `lib/effort/estimate.ts` for why the scale
 * is gentle and why 3 is exactly no change.
 */

const LEVELS = [1, 2, 3, 4, 5] as const;

export function DifficultyControl({
  assignmentId,
  difficulty,
  title,
}: {
  assignmentId: string;
  difficulty: number | null;
  /** For the accessible name — "Rate difficulty" alone is meaningless in a list. */
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const anchor = useRef<HTMLDivElement>(null);

  /*
   * The action is called directly rather than through `<form action={…}>`.
   *
   * With a form, the obvious "close the menu" in the submit button's onClick
   * unmounts the form in the same tick as the submit — React never dispatches
   * it, the rating silently never saves, and the UI looks like it worked.
   * Calling the action and closing only once it resolves has no such race.
   */
  const choose = (level: number | null) => {
    const data = new FormData();
    data.set("assignmentId", assignmentId);
    data.set("difficulty", level === null ? "" : String(level));

    startTransition(async () => {
      await setAssignmentDifficulty(data);
      setOpen(false);
    });
  };

  /* Double-click the row this control sits in. */
  useEffect(() => {
    const row = anchor.current?.closest("li");
    if (!row) return;

    const onDouble = (event: Event) => {
      // Don't hijack a double-click on something already interactive — the
      // completion checkbox and the delete button are both in these rows.
      if ((event.target as HTMLElement).closest("button, a, input, select")) {
        return;
      }
      setOpen(true);
    };

    row.addEventListener("dblclick", onDouble);
    return () => row.removeEventListener("dblclick", onDouble);
  }, []);

  /* Dismiss on outside click or Escape. */
  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const rated = difficulty != null;

  return (
    <div ref={anchor} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          rated
            ? `Difficulty of "${title}": ${DIFFICULTY_LABEL[difficulty]}. Change it.`
            : `Rate the difficulty of "${title}"`
        }
        title={rated ? DIFFICULTY_LABEL[difficulty] : "Rate difficulty"}
        className="flex h-5 w-5 items-center justify-center rounded text-[0.6875rem] font-semibold transition-colors duration-150"
        style={{
          color: rated ? "var(--accent)" : "var(--ink-faint)",
          background: rated ? "var(--accent-soft)" : "transparent",
        }}
      >
        {rated ? difficulty : "·"}
      </button>

      {open ? (
        <div
          role="menu"
          className="card absolute right-0 top-6 z-30 w-44 p-1"
          style={{ boxShadow: "0 6px 24px rgba(22,35,58,0.14)" }}
        >
          <p className="rubric px-2 pb-1 pt-1.5">How hard is this?</p>

          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => choose(level)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[0.8125rem] transition-colors duration-100 hover:bg-accent-soft"
              style={{
                color: level === difficulty ? "var(--accent)" : undefined,
                fontWeight: level === difficulty ? 600 : undefined,
              }}
            >
              <span className="fig w-3 text-ink-faint">{level}</span>
              {DIFFICULTY_LABEL[level]}
            </button>
          ))}

          {rated ? (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => choose(null)}
              className="mt-0.5 w-full rounded border-t border-rule px-2 py-1 text-left text-[0.75rem] text-ink-soft hover:text-[color:var(--flare)]"
            >
              Clear rating
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
