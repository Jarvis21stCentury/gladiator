import type { ElementType, ReactNode } from "react";

import { DifficultyControl } from "@/components/DifficultyControl";
import { courseStyle } from "@/lib/courses/color";
import { STATUS_VAR, levelForDueDate, type StatusLevel } from "@/lib/status";

import { Mark } from "./Mark";

/**
 * A list of items, on a surface.
 *
 * Every list in the product is one of these: deadlines, outstanding work, a
 * day's commitments, the findings in a retro. They now sit on a card, because a
 * bordered surface is what tells you where a list starts and stops — previously
 * six lists down a page were separated by nothing but whitespace and read as one
 * undifferentiated column of text.
 *
 * Rows are 44px, left-aligned text, right-aligned dates, and carry a course
 * colour bar at the left edge. That bar is the fastest thing on the page: it
 * answers "which class" before you have read a word.
 */
export function Docket({
  as: Tag = "ul",
  children,
  className = "",
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tag className={`card docket-list flex flex-col overflow-hidden ${className}`}>
      {children}
    </Tag>
  );
}

function dueLabel(dueAt: Date | null): string {
  if (!dueAt) return "no date";

  const now = new Date();
  const sameDay = dueAt.toDateString() === now.toDateString();

  const time = dueAt.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return `today ${time}`;

  return `${dueAt.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} ${time}`;
}

export function DocketRow({
  title,
  meta,
  action,
  assignmentId,
  difficulty = null,
  trailing,
  dueAt,
  level,
  submitted = false,
  children,
}: {
  title: string;
  /**
   * Course name, category — whatever names where this row came from. When it is
   * a plain string it is treated as the course name and drives the colour bar,
   * which is why every list in the product got colour-coded without a single
   * page being edited.
   */
  meta?: ReactNode;
  /**
   * Controls belonging to this row — completing it, deleting it. Sits at the
   * far right, after the date, and is the only thing in a row that is not text:
   * a row with controls is visibly a row you own, which is how a task you added
   * tells itself apart from an assignment Canvas sent.
   */
  action?: ReactNode;
  /**
   * Present for rows backed by a real assignment. Enables the difficulty rating
   * — how hard *this student* thinks it is, which is the one input the effort
   * estimator cannot get from Canvas.
   */
  assignmentId?: string;
  difficulty?: number | null;
  trailing?: ReactNode;
  dueAt?: Date | null;
  level?: StatusLevel;
  submitted?: boolean;
  children?: ReactNode;
}) {
  const resolved =
    level ?? levelForDueDate(dueAt ?? null, { submitted });
  const inked = resolved !== "calm" && !submitted;

  const course = typeof meta === "string" ? meta : null;

  return (
    <li
      className="border-b border-rule py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-paper-deep/60"
      style={{ "--status": STATUS_VAR[resolved] } as React.CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        {/* Which class. Always the left edge, never text. */}
        <span className="chip" style={courseStyle(course)} aria-hidden="true" />

        {/* How urgent. Always a mark or text, never the left edge. */}
        <Mark level={submitted ? "calm" : resolved} />

        <span
          className="min-w-0 flex-1 truncate text-[0.875rem]"
          style={{
            color: inked ? STATUS_VAR[resolved] : undefined,
            opacity: submitted ? 0.5 : 1,
            textDecoration: submitted ? "line-through" : undefined,
          }}
        >
          {title}
        </span>

        {meta ? (
          <span className="hidden shrink-0 text-[0.75rem] text-ink-soft sm:block">
            {meta}
          </span>
        ) : null}

        <span className="docket shrink-0 text-right text-[0.6875rem] leading-tight">
          {dueAt !== undefined ? (
            <span className="block">{dueLabel(dueAt)}</span>
          ) : null}
          {trailing ? <span className="block opacity-70">{trailing}</span> : null}
        </span>

        {assignmentId ? (
          <DifficultyControl
            assignmentId={assignmentId}
            difficulty={difficulty}
            title={title}
          />
        ) : null}

        {action ? <span className="shrink-0">{action}</span> : null}
      </div>

      {children}
    </li>
  );
}
