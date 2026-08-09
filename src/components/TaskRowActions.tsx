import { deleteTask, toggleTaskDone } from "@/app/actions";

/**
 * The controls on a task you added: tick it off, or delete it.
 *
 * Rendered only for `source: MANUAL` rows. A Canvas assignment's submitted flag
 * belongs to Canvas and would be overwritten on the next sync, so offering a
 * checkbox there would be offering something that silently undoes itself — see
 * the note in `actions.ts`.
 *
 * That restriction turns out to be the design, not a limitation: **a row with
 * controls is visibly a row you own.** No badge, no "added by you" label, no
 * second colour — the affordance is the distinction.
 *
 * Deliberately not a client component. Two `<form>`s posting server actions work
 * with no JavaScript at all, which keeps ticking a task off on the same
 * reliability footing as the rest of the product.
 */
export function TaskRowActions({
  id,
  done,
  title,
}: {
  id: string;
  done: boolean;
  /** For the accessible names — "done" alone is meaningless in a list of ten. */
  title: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <form action={toggleTaskDone}>
        <input type="hidden" name="taskId" value={id} />
        <button
          type="submit"
          aria-pressed={done}
          aria-label={done ? `Mark "${title}" as not done` : `Mark "${title}" done`}
          title={done ? "Mark as not done" : "Mark done"}
          className="flex h-5 w-5 items-center justify-center rounded border transition-colors duration-150"
          style={{
            borderColor: done ? "var(--jade)" : "var(--ink-faint)",
            background: done ? "var(--jade)" : "transparent",
            color: "#FFFFFF",
          }}
        >
          {done ? <span className="text-[0.625rem] leading-none">✓</span> : null}
        </button>
      </form>

      <form action={deleteTask}>
        <input type="hidden" name="taskId" value={id} />
        <button
          type="submit"
          aria-label={`Delete "${title}"`}
          title="Delete task"
          className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors duration-150 hover:bg-paper-deep hover:text-[color:var(--flare)]"
        >
          <span className="text-[0.75rem] leading-none">×</span>
        </button>
      </form>
    </span>
  );
}
