/**
 * The nine weeks you are actually in.
 *
 * Texas schools grade in four nine-week marking periods, and a grade is a fact
 * about *one* of them — it resets when the period closes. So a page that shows
 * "your grade" and "what's outstanding" over the whole year is answering a
 * question the school does not ask. This module says which period today falls
 * in, so the Classes page can scope itself to it and roll over on its own.
 *
 * ## How the boundaries are derived, and what that costs
 *
 * The school year is split into four equal spans of calendar days. That is an
 * approximation and it is worth being precise about the error: a real district
 * calendar puts its boundaries on instructional days, so a period that swallows
 * winter break runs longer in calendar days than one that doesn't. Against
 * Frisco ISD's published 2026-27 dates this lands each boundary within about a
 * week of the real one.
 *
 * The alternative was hard-coding four dates, which is wrong the moment the
 * student is in a different district or the calendar shifts — and this app has
 * already been bitten once by treating one district's calendar as a law of
 * nature. Equal spans self-correct: they are derived from the school-year start
 * and end, both of which the student can edit on the Routine page, and they
 * always tile the year with no gap and no overlap.
 *
 * Pure by design — no `server-only`, no Prisma, no `getSchoolYear` import. The
 * window arrives as a plain `{ start, end }` so a client component can render a
 * period label without dragging the server bundle in behind it, which is a
 * mistake this codebase has made twice.
 */

const PERIODS_PER_YEAR = 4;

const ORDINALS = ["1st", "2nd", "3rd", "4th"] as const;

const DAY_MS = 86_400_000;

/** Structural, so this module never has to import the server-only SchoolYear. */
export interface YearWindow {
  start: Date;
  end: Date;
}

export interface GradingPeriod {
  /** 1-based, the way a student says it: "we're in the 2nd nine weeks". */
  index: number;
  /** "2nd nine weeks" — the spoken name. */
  label: string;
  /** "Q2" — for places too narrow for the full label. */
  short: string;
  /** Local midnight on the first day. */
  start: Date;
  /** Local end-of-day on the last day, so a `<=` comparison includes it. */
  end: Date;
  semester: 1 | 2;
}

function atMidnight(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function atEndOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** `from` plus `days`, via setDate so month lengths and DST are the calendar's problem. */
function addDays(from: Date, days: number): Date {
  const copy = new Date(from);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** All four periods, contiguous, covering exactly the school year. */
export function gradingPeriods(year: YearWindow): GradingPeriod[] {
  const start = atMidnight(year.start);
  const end = atEndOfDay(year.end);

  // A year shorter than four days is nonsense input; clamp so the arithmetic
  // below still produces four non-empty periods rather than dividing by zero.
  const totalDays = Math.max(
    PERIODS_PER_YEAR,
    Math.round((end.getTime() - start.getTime()) / DAY_MS),
  );

  const dayAt = (nth: number) => Math.round((totalDays * nth) / PERIODS_PER_YEAR);

  return ORDINALS.map((ordinal, offset) => ({
    index: offset + 1,
    label: `${ordinal} nine weeks`,
    short: `Q${offset + 1}`,
    start: atMidnight(addDays(start, dayAt(offset))),
    // The last period ends on the last day of the year rather than on a
    // computed boundary, so rounding can never leave the final days uncovered.
    end:
      offset === PERIODS_PER_YEAR - 1
        ? end
        : atEndOfDay(addDays(start, dayAt(offset + 1) - 1)),
    semester: offset < 2 ? 1 : 2,
  }));
}

/**
 * The period containing `now`.
 *
 * Never null. Before the year opens this is the first period — in August a
 * student is looking at the nine weeks about to start, not at nothing — and
 * after it closes it is the last one, so a page opened in June still renders.
 */
export function currentGradingPeriod(
  year: YearWindow,
  now: Date = new Date(),
): GradingPeriod {
  const periods = gradingPeriods(year);

  return (
    periods.find((period) => now >= period.start && now <= period.end) ??
    (now < periods[0].start ? periods[0] : periods[periods.length - 1])
  );
}

/**
 * A Prisma clause bounding assignments to one period.
 *
 * An `AND` fragment for the same reason `withinSchoolYear` is one: several of
 * these `where` clauses already constrain `dueAt`, and a second `dueAt` key
 * would silently replace the first rather than narrowing it.
 */
export function withinGradingPeriod(period: GradingPeriod) {
  return [{ dueAt: { gte: period.start } }, { dueAt: { lte: period.end } }];
}

/** Whole days from `now` to the end of the period; 0 once it has closed. */
export function daysRemaining(period: GradingPeriod, now: Date = new Date()): number {
  return Math.max(
    0,
    Math.ceil((period.end.getTime() - now.getTime()) / DAY_MS),
  );
}
