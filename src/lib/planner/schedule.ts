/**
 * The day's schedule: turning an ordered task list into clock times.
 *
 * ## Why the model does not do this
 *
 * The daily plan asks an LLM for *which* work to do, in *what order*, at *what*
 * length, and *why* — all judgement calls, and the strong model is good at them.
 * It is then handed here, and this file decides what happens at 5:20pm.
 *
 * That split is deliberate. Laying out a day is a constraint-satisfaction
 * problem: blocks must not overlap, must sit inside the hours you actually have
 * free, must not run past the end of the evening, must break for dinner, and
 * must not stack two hours of unbroken work. Language models are unreliable at
 * exactly this kind of arithmetic, and the failure mode is quiet — a schedule
 * that looks plausible and has you eating dinner twice or working until 1am.
 * Everything here is ordinary code that can be tested, and the same reasoning
 * already governs the workload forecast and effort estimation.
 *
 * ## What it guarantees
 *
 * Given free windows that do not overlap each other, every block it returns:
 *   - sits entirely inside one free window,
 *   - starts at or after the previous block ends,
 *   - is at least one minute long,
 * and across the day there is a meal block if one could be placed, and never
 * more than `focusMinutes` of consecutive work without a break.
 *
 * Work that does not fit is dropped rather than squeezed. A plan you cannot
 * finish is worse than a short one — the same rule the prompt gives the model.
 *
 * No "server-only": this is pure functions over plain data, and keeping it
 * importable from a test harness is most of why it is worth having.
 */

export type PlanBlockKind = "WORK" | "BREAK" | "MEAL";

/** A stretch of time with nothing already committed in it. */
export interface FreeInterval {
  start: Date;
  end: Date;
}

/** One item the model wants done today, before it has a time. */
export interface ScheduleRequest {
  assignmentId: string | null;
  title: string;
  reason: string;
  minutes: number;
}

export interface ScheduledBlock {
  kind: PlanBlockKind;
  title: string;
  reason: string;
  assignmentId: string | null;
  start: Date;
  end: Date;
  minutes: number;
}

export interface ScheduleOptions {
  /** Longest run of work before a break is forced in. */
  focusMinutes: number;
  /** A breather between focus runs. */
  breakMinutes: number;
  /** Every `longBreakEvery` breaks is a longer one. */
  longBreakMinutes: number;
  longBreakEvery: number;
  /** Preferred dinner start, as minutes past local midnight. */
  mealStartMinutes: number;
  mealMinutes: number;
  mealTitle: string;
  /** Shortest work block worth scheduling — below this it is just noise. */
  minSessionMinutes: number;
  /**
   * Every start, end and duration is a multiple of this.
   *
   * A schedule is only useful if a person can follow it, and people do not
   * follow "7:15–8:03". Snapping to five minutes costs a few minutes of dead
   * time a day and buys a schedule you can read off a clock.
   */
  granularityMinutes: number;
  /**
   * The largest share of the day's usable time any single task may take, when
   * there is more than one task competing for it.
   *
   * Without this, one big item starves everything behind it — a 115-minute lab
   * report swallowed an entire evening and four other pieces of work were
   * dropped, including one due the next morning. Partial progress on the three
   * things that matter beats finishing one and abandoning the rest, and the
   * estimate that produced the 115 was a guess anyway.
   */
  maxShareOfDay: number;
}

export const DEFAULT_SCHEDULE_OPTIONS: ScheduleOptions = {
  focusMinutes: 50,
  breakMinutes: 10,
  longBreakMinutes: 20,
  longBreakEvery: 3,
  mealStartMinutes: 18 * 60,
  mealMinutes: 45,
  mealTitle: "Dinner",
  minSessionMinutes: 15,
  granularityMinutes: 5,
  maxShareOfDay: 0.5,
};

export interface ScheduleResult {
  blocks: ScheduledBlock[];
  /** Requests that got no time at all. */
  dropped: ScheduleRequest[];
  /** True when the day had no room for the meal block. */
  mealSkipped: boolean;
  scheduledWorkMinutes: number;
}

const MS_PER_MINUTE = 60_000;

const floorTo = (minutes: number, grid: number) =>
  Math.floor(minutes / grid) * grid;
const roundTo = (minutes: number, grid: number) =>
  Math.round(minutes / grid) * grid;

/** Next grid boundary at or after `date`. */
function ceilToGrid(date: Date, grid: number): Date {
  const ms = grid * MS_PER_MINUTE;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE);
}

function atMinuteOfDay(reference: Date, minutes: number): Date {
  const result = new Date(reference);
  result.setHours(0, 0, 0, 0);
  return addMinutes(result, minutes);
}

/**
 * Reserve the meal, splitting whichever free interval contains it.
 *
 * The meal is placed *before* any work is laid out, rather than being slotted
 * in afterwards, because it is the one fixed point in the evening: work bends
 * around dinner, not the other way round. If the preferred time is not inside
 * any free window — the student is out until 7 — the meal is skipped rather
 * than shoved somewhere arbitrary, and the caller is told.
 */
function reserveMeal(
  intervals: FreeInterval[],
  options: ScheduleOptions,
  reference: Date,
): { intervals: FreeInterval[]; meal: ScheduledBlock | null } {
  const preferredStart = atMinuteOfDay(reference, options.mealStartMinutes);
  const preferredEnd = addMinutes(preferredStart, options.mealMinutes);

  for (const [index, interval] of intervals.entries()) {
    const fitsWhereWanted =
      preferredStart >= interval.start && preferredEnd <= interval.end;

    // Second chance: the window opens after the preferred time (school ran
    // late), so eat as soon as the evening starts rather than not at all.
    const fitsAtWindowStart =
      !fitsWhereWanted &&
      interval.start > preferredStart &&
      minutesBetween(interval.start, interval.end) >= options.mealMinutes;

    if (!fitsWhereWanted && !fitsAtWindowStart) continue;

    const start = ceilToGrid(
      fitsWhereWanted ? preferredStart : interval.start,
      options.granularityMinutes,
    );
    const end = addMinutes(start, options.mealMinutes);

    // Snapping can push the meal past the end of the window it was going to fit
    // in; if it no longer fits, keep looking.
    if (end > interval.end) continue;

    const remaining: FreeInterval[] = [];
    if (minutesBetween(interval.start, start) > 0) {
      remaining.push({ start: interval.start, end: start });
    }
    if (minutesBetween(end, interval.end) > 0) {
      remaining.push({ start: end, end: interval.end });
    }

    return {
      intervals: [
        ...intervals.slice(0, index),
        ...remaining,
        ...intervals.slice(index + 1),
      ],
      meal: {
        kind: "MEAL",
        title: options.mealTitle,
        reason: "Eat properly — the evening goes badly without it.",
        assignmentId: null,
        start,
        end,
        minutes: minutesBetween(start, end),
      },
    };
  }

  return { intervals, meal: null };
}

/**
 * Lay an ordered task list onto the clock.
 *
 * Tasks longer than one focus run are split into numbered sessions rather than
 * scheduled as a single unbroken slab — a two-hour block with no break is the
 * thing this feature exists to prevent, and splitting it is also how the work
 * actually gets done.
 */
export function buildSchedule(
  requests: ScheduleRequest[],
  freeWindows: FreeInterval[],
  reference: Date,
  overrides: Partial<ScheduleOptions> = {},
): ScheduleResult {
  const options = { ...DEFAULT_SCHEDULE_OPTIONS, ...overrides };

  // Defensive: the caller's windows are assumed non-overlapping and sorted, and
  // everything below depends on it. Sorting costs nothing and removes a whole
  // class of "why is dinner inside my chemistry block" bug.
  const sorted = [...freeWindows]
    .filter((window) => minutesBetween(window.start, window.end) > 0)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const { intervals, meal } = reserveMeal(sorted, options, reference);

  /*
   * Fair share. Computed from the time left *after* dinner is reserved, so the
   * cap reflects the evening you actually have rather than the one on paper.
   * The floor of one focus run stops a very short evening capping every task
   * into uselessness.
   */
  const usableMinutes = intervals.reduce(
    (sum, interval) => sum + minutesBetween(interval.start, interval.end),
    0,
  );
  const shareCap =
    requests.length > 1
      ? Math.max(
          options.focusMinutes,
          floorTo(
            usableMinutes * options.maxShareOfDay,
            options.granularityMinutes,
          ),
        )
      : Number.POSITIVE_INFINITY;

  const blocks: ScheduledBlock[] = [];
  const dropped: ScheduleRequest[] = [];

  let intervalIndex = 0;
  // Explicitly nullable: `intervals[0]?.start` is typed non-optional, so the
  // `?? null` reads as dead code and the whole thing infers as `Date` — which
  // silently makes "we have run out of day" unrepresentable.
  let cursor: Date | null = intervals[0]
    ? ceilToGrid(intervals[0].start, options.granularityMinutes)
    : null;
  /** Minutes of work since the last break, across intervals. */
  let focusRun = 0;
  let breaksTaken = 0;
  let scheduledWorkMinutes = 0;

  /** Minutes left in the interval the cursor sits in. */
  const remainingHere = (): number => {
    const interval = intervals[intervalIndex];
    if (!interval || !cursor) return 0;
    return Math.max(0, minutesBetween(cursor, interval.end));
  };

  /** Move to the next interval that has any room. Returns false when out. */
  const advanceInterval = (): boolean => {
    intervalIndex += 1;
    while (intervalIndex < intervals.length) {
      const interval = intervals[intervalIndex];
      if (minutesBetween(interval.start, interval.end) > 0) {
        cursor = ceilToGrid(interval.start, options.granularityMinutes);
        // A gap in the day *is* a break — crossing one clears the focus run,
        // so the schedule never inserts a ten-minute breather immediately
        // after an hour of free time.
        focusRun = 0;
        return true;
      }
      intervalIndex += 1;
    }
    cursor = null;
    return false;
  };

  for (const request of requests) {
    const wanted = roundTo(
      Math.min(Math.max(0, request.minutes), shareCap),
      options.granularityMinutes,
    );
    if (wanted === 0) continue;

    let left = wanted;

    /*
     * Sessions are balanced, not greedy.
     *
     * Filling each focus run to the brim and letting the remainder fall out the
     * end turns 60 minutes into "50 minutes, break, 10 minutes" — and a 45
     * minute task into a 40 minute block, a *20 minute* break, and a 5 minute
     * stub, which is a worse plan than not splitting at all. Dividing the work
     * evenly across the number of runs it needs gives 30 + 30, and never
     * produces a session too short to be worth sitting down for.
     */
    const sessionsExpected = Math.ceil(wanted / options.focusMinutes);
    const targetSession = Math.min(
      options.focusMinutes,
      roundTo(wanted / sessionsExpected, options.granularityMinutes),
    );

    /*
     * Blocks for *this* request, held aside so they can be numbered once the
     * real session count is known. Labelling during the loop used the count
     * predicted up front, and a window boundary that forced an extra split
     * produced "Calc problem set (3 of 2)".
     */
    const placed: ScheduledBlock[] = [];

    while (left > 0) {
      if (!cursor) break;

      if (remainingHere() === 0 && !advanceInterval()) break;

      /*
       * Break when the focus budget left is too small to seat a useful session
       * — not merely when it hits zero.
       *
       * Checking `focusRun >= focusMinutes` looked equivalent and was not: a 45
       * minute session leaves 5 minutes of budget, which is below the minimum
       * session, so the next task found no room, gave up on the *window*
       * instead of taking a break, and the evening ended two hours early with
       * work still on the list.
       */
      const focusLeft = options.focusMinutes - focusRun;
      const want = Math.min(left, targetSession);
      // Break when the focus budget cannot seat a *whole* session, not merely
      // when it is empty — otherwise a session gets truncated and its remainder
      // comes back as a five-minute stub after a twenty-minute break.
      if (focusRun > 0 && focusLeft < want) {
        breaksTaken += 1;
        const isLong = breaksTaken % options.longBreakEvery === 0;
        const wantedBreak = isLong
          ? options.longBreakMinutes
          : options.breakMinutes;
        const breakMinutes = Math.min(wantedBreak, remainingHere());

        if (breakMinutes > 0) {
          // Label from what the break actually got, not what it was meant to
          // be: a run into the dinner boundary produced a five-minute block
          // titled "Longer break", and a schedule that misdescribes itself is
          // one a student stops trusting.
          const readsLong = breakMinutes >= options.longBreakMinutes;

          blocks.push({
            kind: "BREAK",
            title: readsLong ? "Longer break" : "Break",
            reason: readsLong
              ? "Get up, get away from the desk."
              : "Short breather — stand up, water.",
            assignmentId: null,
            start: cursor,
            end: addMinutes(cursor, breakMinutes),
            minutes: breakMinutes,
          });
          cursor = addMinutes(cursor, breakMinutes);
        }

        focusRun = 0;

        if (remainingHere() === 0 && !advanceInterval()) break;
      }

      const ideal = Math.min(
        remainingHere(),
        options.focusMinutes - focusRun,
        // Aim for an even session, but never leave a scrap smaller than the
        // minimum behind — absorb it into this block instead.
        left - targetSession < options.minSessionMinutes ? left : targetSession,
        left,
      );

      // Durations stay on the grid. Rounding *down* keeps the block inside the
      // window it was measured against; the few minutes lost are the price of a
      // schedule that reads in round numbers.
      const room =
        ideal >= left ? ideal : floorTo(ideal, options.granularityMinutes);

      // Not enough room here to be worth starting: take the next window.
      if (room < Math.min(options.minSessionMinutes, left)) {
        if (!advanceInterval()) break;
        continue;
      }

      placed.push({
        kind: "WORK",
        title: request.title,
        reason: request.reason,
        assignmentId: request.assignmentId,
        start: cursor,
        end: addMinutes(cursor, room),
        minutes: room,
      });

      cursor = addMinutes(cursor, room);
      focusRun += room;
      left -= room;
      scheduledWorkMinutes += room;
    }

    if (placed.length === 0) {
      dropped.push(request);
      continue;
    }

    // Number from what was actually placed, so the label can never lie.
    if (placed.length > 1) {
      placed.forEach((block, index) => {
        block.title = `${request.title} (${index + 1} of ${placed.length})`;
      });
    }

    blocks.push(...placed);
  }

  if (meal) blocks.push(meal);
  blocks.sort((a, b) => a.start.getTime() - b.start.getTime());

  /*
   * A break is only worth showing between two pieces of work. Once the tasks
   * run out, a trailing "break" is just an odd way of saying the evening is
   * over — and the same is true of a break that only separates work from
   * dinner, which is already a break.
   */
  while (blocks.length > 0 && blocks[blocks.length - 1].kind === "BREAK") {
    blocks.pop();
  }

  return {
    blocks,
    dropped,
    mealSkipped: meal === null,
    scheduledWorkMinutes,
  };
}
