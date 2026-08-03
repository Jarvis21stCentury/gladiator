import type { ElementType, ReactNode } from "react";

import { STATUS_VAR, levelForDueDate, type StatusLevel } from "@/lib/status";

import { Mark } from "./Mark";

/**
 * The docket — a ruled timetable of items.
 *
 * Every list in the product is one of these: deadlines, outstanding work, a
 * day's commitments, the findings in a retro. They are printed as rows on a
 * ruled sheet, so a page of them reads as a schedule rather than as a stack of
 * cards, and so a long list stays scannable at the only speed it matters at —
 * the speed you check what is due tomorrow.
 *
 * Rows reveal along their own rule (MOTION.md → Docket Advance) rather than
 * fading up, which is both faster to read and physically what a printed line is.
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
    <Tag className={`flex flex-col ${className}`}>
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
  trailing,
  dueAt,
  level,
  submitted = false,
  children,
}: {
  title: string;
  /** Course name, category — whatever names where this row came from. */
  meta?: ReactNode;
  trailing?: ReactNode;
  dueAt?: Date | null;
  level?: StatusLevel;
  submitted?: boolean;
  children?: ReactNode;
}) {
  const resolved =
    level ?? levelForDueDate(dueAt ?? null, { submitted });
  const inked = resolved !== "calm" && !submitted;

  return (
    <li
      className="border-b border-rule/70 py-3.5 last:border-b-0"
      data-advance=""
      style={{ "--status": STATUS_VAR[resolved] } as React.CSSProperties}
    >
      <div className="flex items-baseline gap-3">
        <span className="translate-y-[-0.1rem]">
          <Mark level={submitted ? "calm" : resolved} />
        </span>

        <span
          className="min-w-0 flex-1 text-[0.95rem] leading-snug"
          style={{
            color: inked ? STATUS_VAR[resolved] : undefined,
            opacity: submitted ? 0.55 : 1,
            textDecoration: submitted ? "line-through" : undefined,
          }}
        >
          {title}
          {meta ? (
            <span className="rubric ml-3 whitespace-nowrap">{meta}</span>
          ) : null}
        </span>

        <span className="docket shrink-0 text-right leading-snug">
          {dueAt !== undefined ? (
            <span className="block">{dueLabel(dueAt)}</span>
          ) : null}
          {trailing ? <span className="block opacity-70">{trailing}</span> : null}
        </span>
      </div>

      {children}
    </li>
  );
}
