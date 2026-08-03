/**
 * The status ladder, in one place.
 *
 * CLAUDE.md's cohesion rule is that the ink ramp means the same thing on every
 * screen. That only holds if there is exactly one function deciding what level a
 * thing is at — otherwise the Classes ledger and the Calendar timetable drift
 * apart within a week. Every mark, meter and column on the site resolves its
 * ink through this module.
 *
 * No "server-only" here on purpose: client components need it too.
 */

/**
 * calm → warming → urgent.
 *
 * In the almanac's ink language `calm` is *plain ink* — no second plate. A page
 * where nothing is wrong prints in one colour, and the signal inks (ochre, then
 * vermilion) only appear where attention is genuinely due. Moss exists for the
 * affirmative case (closed, submitted, improving) and is asked for explicitly,
 * not derived from a level.
 */
export type StatusLevel = "calm" | "warming" | "urgent";

const LEVEL_RANK: Record<StatusLevel, number> = {
  calm: 0,
  warming: 1,
  urgent: 2,
};

/** CSS custom property per level. Never hard-code a hex at a call site. */
export const STATUS_VAR: Record<StatusLevel, string> = {
  calm: "var(--ink)",
  warming: "var(--ochre)",
  urgent: "var(--vermilion)",
};

/** The affirmative ink. Not on the ladder — asked for by name where it applies. */
export const AFFIRM_VAR = "var(--moss)";

export const STATUS_LABEL: Record<StatusLevel, string> = {
  calm: "on track",
  warming: "due soon",
  urgent: "needs attention",
};

export function maxLevel(...levels: StatusLevel[]): StatusLevel {
  return levels.reduce<StatusLevel>(
    (worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst),
    "calm",
  );
}

export function rankOf(level: StatusLevel): number {
  return LEVEL_RANK[level];
}

/** StruggleFlag.severity (1–3) → level. The schema documents the same ladder. */
export function levelFromSeverity(severity: number): StatusLevel {
  if (severity >= 3) return "urgent";
  if (severity >= 2) return "warming";
  return "calm";
}

/**
 * How a single deadline reads. Anything already past its due date and
 * unsubmitted is urgent regardless of size — that is the case the user most
 * needs to see the moment the page opens.
 */
export function levelForDueDate(
  dueAt: Date | null,
  options: { submitted?: boolean; now?: Date } = {},
): StatusLevel {
  const { submitted = false, now = new Date() } = options;

  if (submitted || !dueAt) return "calm";

  const hoursAway = (dueAt.getTime() - now.getTime()) / 3_600_000;

  if (hoursAway < 0) return "urgent";
  if (hoursAway <= 24) return "urgent";
  if (hoursAway <= 72) return "warming";
  return "calm";
}

/**
 * Workload density → level, where `ratio` is committed minutes over available
 * minutes. Slightly over budget is a warning; half again over is the point at
 * which the day genuinely cannot be finished.
 */
export function levelForLoad(ratio: number): StatusLevel {
  if (ratio >= 1.5) return "urgent";
  if (ratio >= 0.9) return "warming";
  return "calm";
}

/**
 * Grade → level. Deliberately generous at the top: this is a nudge system, not
 * a report card, and colouring a B amber every day would make amber meaningless.
 */
export function levelForGrade(percent: number | null): StatusLevel {
  if (percent === null) return "calm";
  if (percent < 70) return "urgent";
  if (percent < 80) return "warming";
  return "calm";
}
