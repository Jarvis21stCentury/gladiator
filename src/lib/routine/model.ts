/**
 * The student's normal week, turned into "when are you actually free".
 *
 * This is the input the planner was missing. Free time used to be a fixed clock
 * range from an env var — 16:00 to 21:30, the same for everybody, every day —
 * minus whatever was on their Google Calendar. For a student with no Google
 * Calendar connected, that meant the schedule was a guess dressed up as a plan.
 *
 * Now: the day is bounded by when you wake and when you sleep, school and
 * practice and shifts are carved out of it, and what is left is genuinely yours.
 *
 * **No `server-only` here.** This is pure arithmetic over plain data and the
 * routine editor is a client component that needs the same clock helpers and the
 * same free-time preview the planner uses. Database access lives next door in
 * `routine.ts`; keeping them apart is also what makes the invariants below
 * testable outside Next.
 *
 * ## Times are minutes past midnight, deliberately
 *
 * A routine is a *clock* fact: "practice ends at six" is true every Tuesday,
 * independent of date. Storing it as a timestamp on some arbitrary day is how a
 * planner ends up telling someone to start work at 3am after the clocks change.
 * Everything here works in minutes and is only turned into a `Date` at the last
 * moment, against the specific day being planned.
 */

export interface RoutineInterval {
  startMinutes: number;
  endMinutes: number;
  label: string;
  kind: "SLEEP" | "SCHOOL" | "ACTIVITY" | "PERSONAL";
}

export interface DayRoutine {
  /** Earliest minute anything may be scheduled — the end of the sleep block. */
  dayStartMinutes: number;
  /** Latest minute anything may run to — the start of the evening sleep block. */
  dayEndMinutes: number;
  /** Everything busy inside those bounds, sorted and merged. */
  busy: RoutineInterval[];
  /** False when the student has not set a routine for this weekday at all. */
  configured: boolean;
}

/**
 * Fallbacks for a student who has not set anything up yet.
 *
 * Chosen to be plausible rather than neutral: an empty routine that produced no
 * free time would make the planner silently do nothing on first run, which
 * looks broken. These match the old hard-coded window so nothing regresses for
 * an existing user, and the UI nudges them to replace it.
 */
export const DEFAULT_DAY_START = 16 * 60;
export const DEFAULT_DAY_END = 21 * 60 + 30;

const MINUTES_IN_DAY = 24 * 60;

export function clampMinutes(value: number): number {
  return Math.max(0, Math.min(MINUTES_IN_DAY, Math.round(value)));
}

/** "17:45" → 1065. Returns null for anything that isn't a real clock time. */
export function parseClock(input: string): number | null {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1065 → "17:45". */
export function formatClock(minutes: number): string {
  const total = clampMinutes(minutes);
  const hours = Math.floor(total / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 1065 → "5:45 PM", for reading rather than editing. */
export function formatClock12(minutes: number): string {
  const total = clampMinutes(minutes);
  const hours24 = Math.floor(total / 60) % 24;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(total % 60).padStart(2, "0")} ${suffix}`;
}

/**
 * Merge overlapping busy intervals.
 *
 * Overlaps are normal, not an error: a student adds "school 08:00–15:20" and
 * then "band practice 15:00–16:30" because that is how they think about their
 * week. Left unmerged, the free-window walk would emit a negative-length gap
 * between them and the day would quietly lose time.
 */
function merge(intervals: RoutineInterval[]): RoutineInterval[] {
  const sorted = [...intervals]
    .filter((interval) => interval.endMinutes > interval.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const merged: RoutineInterval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];

    if (last && interval.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, interval.endMinutes);
      // Keep the earlier block's name — it is the one the student saw first,
      // and a merged interval showing the *second* label reads as a bug.
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

export interface RoutineBlockRecord {
  id: string;
  dayOfWeek: number;
  kind: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
}

/**
 * Turn the stored week into the bounds and busy list for one weekday.
 *
 * Sleep bounds the day rather than sitting inside it, so a SLEEP block is read
 * as **`startMinutes` = bedtime, `endMinutes` = wake time** — always, with no
 * attempt to guess from the numbers. The editor asks for exactly those two
 * things, which is why the interpretation can be fixed rather than inferred.
 *
 * That fixed reading is the fix for a real bug. The first version decided based
 * on whether the block crossed midnight: `22:30–07:00` bounded the day, but a
 * perfectly ordinary Saturday lie-in entered as `01:00–10:00` did not cross
 * midnight, so it was classified as a *nap*, marked busy, and the day silently
 * fell back to the 16:00 default — losing the entire morning and afternoon of
 * the one day with the most free time in it.
 *
 * Both now work:
 *   bed 22:30, wake 07:00 → day runs 07:00 to 22:30.
 *   bed 01:00, wake 10:00 → day runs 10:00 to midnight (you are up past 00:00,
 *                           and nothing is scheduled across the date boundary).
 */
export function resolveDay(
  blocks: RoutineBlockRecord[],
  dayOfWeek: number,
): DayRoutine {
  const forDay = blocks.filter((block) => block.dayOfWeek === dayOfWeek);

  if (forDay.length === 0) {
    return {
      dayStartMinutes: DEFAULT_DAY_START,
      dayEndMinutes: DEFAULT_DAY_END,
      busy: [],
      configured: false,
    };
  }

  const sleep = forDay.filter((block) => block.kind === "SLEEP");
  const rest = forDay.filter((block) => block.kind !== "SLEEP");

  let dayStart: number | null = null;
  let dayEnd: number | null = null;

  for (const block of sleep) {
    const bedtime = clampMinutes(block.startMinutes);
    const wake = clampMinutes(block.endMinutes);

    // The day opens when you wake.
    dayStart = dayStart === null ? wake : Math.max(dayStart, wake);

    // It closes at bedtime — unless bedtime is *after* midnight, in which case
    // the rest of this calendar day is yours and the limit is midnight.
    const closes = bedtime > wake ? bedtime : MINUTES_IN_DAY;
    dayEnd = dayEnd === null ? closes : Math.min(dayEnd, closes);
  }

  // A day with activities but no sleep set still needs bounds.
  if (dayStart === null || dayEnd === null) {
    dayStart = DEFAULT_DAY_START;
    dayEnd = DEFAULT_DAY_END;
  }

  const busy = merge(
    rest.map((block) => ({
      startMinutes: clampMinutes(block.startMinutes),
      endMinutes: clampMinutes(block.endMinutes),
      label: block.label,
      kind: block.kind as RoutineInterval["kind"],
    })),
  );

  return {
    dayStartMinutes: dayStart,
    dayEndMinutes: Math.max(dayStart, dayEnd),
    busy,
    configured: true,
  };
}

export interface FreeSpan {
  startMinutes: number;
  endMinutes: number;
}

/** The gaps left inside the day's bounds once the routine is carved out. */
export function freeSpans(day: DayRoutine): FreeSpan[] {
  const spans: FreeSpan[] = [];
  let cursor = day.dayStartMinutes;

  for (const block of day.busy) {
    const start = Math.max(day.dayStartMinutes, block.startMinutes);
    const end = Math.min(day.dayEndMinutes, block.endMinutes);

    if (end <= cursor) continue;
    if (start > cursor) spans.push({ startMinutes: cursor, endMinutes: start });

    cursor = Math.max(cursor, end);
  }

  if (cursor < day.dayEndMinutes) {
    spans.push({ startMinutes: cursor, endMinutes: day.dayEndMinutes });
  }

  return spans;
}

/** Total free minutes a weekday offers before any coursework is placed. */
export function freeMinutes(day: DayRoutine): number {
  return freeSpans(day).reduce(
    (sum, span) => sum + (span.endMinutes - span.startMinutes),
    0,
  );
}
