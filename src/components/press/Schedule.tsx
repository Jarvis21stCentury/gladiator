import { togglePlanTask } from "@/app/actions";
import { courseStyle } from "@/lib/courses/color";
import { STATUS_VAR, levelForDueDate } from "@/lib/status";

import { ScheduleNow } from "./ScheduleNow";

/**
 * Today's schedule, as a timeline.
 *
 * The plan used to be an ordered list with a minute count on each row — "45m",
 * "30m" — which told you what to do but never when, so the ordering was advice
 * rather than a plan. Every row now carries the clock time it starts, and
 * breaks and dinner are rows in the same sequence rather than something you are
 * expected to remember to do.
 *
 * The times run down a fixed-width rail on the left so they form a column you
 * can scan, which is the whole reason for reading a schedule: not "what is
 * next" but "what am I meant to be doing right now".
 *
 * Only work blocks can be ticked off. Checking off dinner is not a feature.
 */

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

interface ScheduleBlock {
  id: string;
  kind: string;
  title: string;
  reason: string;
  estimatedMinutes: number;
  startAt: Date | null;
  endAt: Date | null;
  done: boolean;
  assignment: { dueAt: Date | null; course: { name: string } } | null;
}

export function Schedule({ blocks }: { blocks: ScheduleBlock[] }) {
  /*
   * A task split into three sessions repeated its reason on all three —
   * "Overdue — clear it before it costs you more." three times down one card.
   * The reason belongs to the task, so it is shown once, on its first session.
   * Breaks and dinner get none at all: "Break" needs no explanation, and
   * "Short breather — stand up, water" on every one of them was the single
   * largest source of text on the page.
   */
  const explained = new Set<string>();

  return (
    <ol className="card docket-list flex flex-col overflow-hidden">
      {/* Renders nothing; marks the live row. See ScheduleNow. */}
      <ScheduleNow />

      {blocks.map((block) => {
        const isWork = block.kind === "WORK";
        const taskKey = block.title.replace(/ \(\d+ of \d+\)$/, "");
        const showReason = isWork && !explained.has(taskKey);
        if (showReason) explained.add(taskKey);
        const level =
          block.done || !isWork
            ? "calm"
            : levelForDueDate(block.assignment?.dueAt ?? null);
        const inked = level !== "calm";

        return (
          <li
            key={block.id}
            /* Epoch milliseconds for the client-side "which row is live" pass.
               Numbers rather than ISO strings so it is a comparison, not a
               parse, on every tick. */
            data-start={block.startAt?.getTime()}
            data-end={block.endAt?.getTime()}
            className="row-live flex items-start gap-3 border-b border-rule py-2.5 last:border-b-0"
            style={{ opacity: block.done ? 0.55 : 1 }}
          >
            {/* The clock rail. Tabular so the column lines up. */}
            <span className="docket fig w-[4.25rem] shrink-0 pt-0.5 text-[0.75rem] leading-tight">
              {block.startAt ? (
                <>
                  <span className="block text-ink">
                    {block.startAt.toLocaleTimeString([], TIME_FORMAT)}
                  </span>
                  <span className="block text-[0.625rem] opacity-60">
                    {block.estimatedMinutes}m
                  </span>
                </>
              ) : (
                <span className="opacity-60">{block.estimatedMinutes}m</span>
              )}
            </span>

            {isWork ? (
              <>
                <form action={togglePlanTask} className="shrink-0 pt-1">
                  <input type="hidden" name="taskId" value={block.id} />
                  <button
                    type="submit"
                    aria-pressed={block.done}
                    aria-label={
                      block.done
                        ? `Reopen ${block.title}`
                        : `Mark ${block.title} done`
                    }
                    className="flex h-[17px] w-[17px] items-center justify-center rounded border transition-colors duration-150"
                    style={{
                      borderColor: block.done ? "var(--jade)" : "var(--ink-faint)",
                      background: block.done ? "var(--jade)" : "transparent",
                      color: "#FFFFFF",
                    }}
                  >
                    {block.done ? (
                      <span className="text-[0.5625rem] leading-none">✓</span>
                    ) : null}
                  </button>
                </form>

                {/* Which class, in the same slot it occupies on every other
                    list in the product. */}
                <span
                  className="chip mt-1"
                  style={courseStyle(block.assignment?.course.name)}
                  aria-hidden="true"
                />
              </>
            ) : (
              /* Breaks and dinner take the checkbox's width so the titles below
                 them still line up, but offer nothing to press. */
              <span className="w-[calc(17px+0.75rem+3px)] shrink-0" aria-hidden="true" />
            )}

            <div className="min-w-0 flex-1">
              <p
                className="text-[0.875rem] leading-snug"
                style={{
                  color: inked ? STATUS_VAR[level] : undefined,
                  textDecoration: block.done ? "line-through" : undefined,
                  // Breaks and meals are the furniture of the day, not its
                  // content — they read one step quieter than the work.
                  opacity: isWork ? 1 : 0.7,
                  fontStyle: isWork ? undefined : "italic",
                }}
              >
                {block.title}
              </p>
              {showReason ? (
                <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-soft">
                  {block.reason}
                </p>
              ) : null}
            </div>

            {block.assignment ? (
              <span className="hidden shrink-0 pt-0.5 text-[0.75rem] text-ink-soft sm:block">
                {block.assignment.course.name}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
