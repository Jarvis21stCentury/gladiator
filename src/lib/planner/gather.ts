import "server-only";

import { createEstimator, type EffortSource } from "@/lib/effort/estimate";
import { prisma } from "@/lib/prisma";
import { freeSpans, resolveDay } from "@/lib/routine/model";
import { getRoutine } from "@/lib/routine/routine";
import type { ScheduleOptions } from "./schedule";

/**
 * Assembles everything the daily plan is built from: what's due, how long each
 * item is likely to take, and how much time actually exists today.
 *
 * Estimation itself lives in `@/lib/effort/estimate` so the workload forecast
 * prices the same assignment the same way this does.
 */

/** How far ahead to consider work. Beyond this, it isn't today's problem. */
const LOOKAHEAD_DAYS = 10;

/** Default study window when nothing else is configured (local time, 24h). */
const DEFAULT_WINDOW_START = 16 * 60; // 16:00
const DEFAULT_WINDOW_END = 21 * 60 + 30; // 21:30

export type { EffortSource };

export interface PlanCandidate {
  assignmentId: string;
  title: string;
  courseName: string;
  dueAt: Date | null;
  pointsPossible: number | null;
  /** Negative once overdue. */
  daysUntilDue: number | null;
  overdue: boolean;
  estimatedMinutes: number;
  effortSource: EffortSource;
  /** The student's own 1–5 rating, or null. Already reflected in the estimate. */
  difficulty: number | null;
}

export interface FreeWindow {
  start: Date;
  end: Date;
  minutes: number;
}

export interface PlanInputs {
  date: Date;
  candidates: PlanCandidate[];
  freeWindows: FreeWindow[];
  totalFreeMinutes: number;
  busyTitles: string[];
  /** Break cadence and meal placement for the layout pass. */
  scheduleOptions: Partial<ScheduleOptions>;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function atMinutes(day: Date, minutes: number): Date {
  const result = new Date(day);
  result.setHours(0, 0, 0, 0);
  result.setMinutes(minutes);
  return result;
}

/** A plain integer env override, ignored when absent or nonsense. */
function readMinutes(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

/**
 * How the day gets laid out, from env, with defaults that suit a school
 * evening. Same pattern as the study window above: configurable without a
 * settings screen, and sane when nothing is set.
 */
function readScheduleOptions(): Partial<ScheduleOptions> {
  return {
    focusMinutes: readMinutes("PLAN_FOCUS_MINUTES", 50),
    breakMinutes: readMinutes("PLAN_BREAK_MINUTES", 10),
    longBreakMinutes: readMinutes("PLAN_LONG_BREAK_MINUTES", 20),
    longBreakEvery: readMinutes("PLAN_LONG_BREAK_EVERY", 3),
    mealStartMinutes: readWindow("PLAN_DINNER_START", 18 * 60),
    mealMinutes: readMinutes("PLAN_DINNER_MINUTES", 45),
  };
}

function readWindow(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;

  return Number(match[1]) * 60 + Number(match[2]);
}

export async function getPlanInputs(date: Date): Promise<PlanInputs> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const horizon = new Date(dayStart);
  horizon.setDate(horizon.getDate() + LOOKAHEAD_DAYS);

  const [routine, assignments, estimator] = await Promise.all([
    getRoutine(),
    prisma.assignment.findMany({
      where: {
        submitted: false,
        dueAt: { not: null, lt: horizon },
        course: { hidden: false },
      },
      orderBy: { dueAt: "asc" },
      include: { course: { select: { id: true, name: true } } },
    }),
    createEstimator(),
  ]);

  const candidates: PlanCandidate[] = assignments.map((assignment) => {
    const { minutes: estimatedMinutes, source: effortSource } =
      estimator.estimate(assignment);

    const dueAt = assignment.dueAt;
    const daysUntilDue = dueAt
      ? Math.round((dueAt.getTime() - dayStart.getTime()) / 86_400_000)
      : null;

    return {
      assignmentId: assignment.id,
      title: assignment.title,
      courseName: assignment.course.name,
      dueAt,
      pointsPossible: assignment.pointsPossible,
      daysUntilDue,
      overdue: dueAt !== null && dueAt < dayStart,
      // Clamp so one bad log can't propose an 8-hour block.
      estimatedMinutes: Math.min(240, Math.max(10, estimatedMinutes)),
      effortSource,
      difficulty: assignment.difficulty,
    };
  });

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const blocks = await prisma.calendarBlock.findMany({
    where: { start: { gte: dayStart, lt: dayEnd } },
    orderBy: { start: "asc" },
  });

  // Assignment blocks are 30-minute deadline markers this app wrote, not
  // commitments — counting them as busy would eat the very time we're planning.
  const busy = blocks.filter((block) => block.type !== "ASSIGNMENT");

  /*
   * Free time comes from the student's own routine.
   *
   * This used to be a single clock range from an env var — 16:00 to 21:30 for
   * everyone, every day of the week — which is wrong for almost every real
   * student and produced schedules that could not be followed. The routine
   * knows when they wake, when school ends, when practice runs and when they go
   * to bed, per weekday.
   *
   * `PLAN_WINDOW_START` / `PLAN_WINDOW_END` are still the fallback for a
   * student who has not set a routine yet, so nothing regresses on first run.
   *
   * Google Calendar commitments are then subtracted on top: the routine is what
   * happens every week, the calendar is what happens *this* week, and both are
   * busy.
   */
  const day = resolveDay(routine, dayStart.getDay());

  const windowStart = day.configured
    ? day.dayStartMinutes
    : readWindow("PLAN_WINDOW_START", DEFAULT_WINDOW_START);
  const windowEnd = day.configured
    ? day.dayEndMinutes
    : readWindow("PLAN_WINDOW_END", DEFAULT_WINDOW_END);

  // One combined busy list: routine blocks plus today's calendar events.
  const busyMinutes = [
    ...day.busy.map((block) => ({
      start: block.startMinutes,
      end: block.endMinutes,
    })),
    ...busy.map((block) => ({
      start: minutesOfDay(block.start),
      end: minutesOfDay(block.end),
    })),
  ];

  const spans = freeSpans({
    dayStartMinutes: windowStart,
    dayEndMinutes: windowEnd,
    configured: day.configured,
    busy: busyMinutes
      .map((block) => ({
        startMinutes: block.start,
        endMinutes: block.end,
        label: "",
        kind: "ACTIVITY" as const,
      }))
      // `freeSpans` merges, but only after sorting — and it expects intervals
      // that make sense. A calendar event running past midnight arrives here as
      // end < start, which would silently swallow the rest of the evening.
      .filter((block) => block.endMinutes > block.startMinutes),
  });

  const freeWindows: FreeWindow[] = spans.map((span) => ({
    start: atMinutes(dayStart, span.startMinutes),
    end: atMinutes(dayStart, span.endMinutes),
    minutes: span.endMinutes - span.startMinutes,
  }));

  /*
   * Nothing is scheduled into the past.
   *
   * The window is a clock range — 16:00 to 21:30 — and regenerating a plan at
   * 7pm would otherwise hand the layout pass three and a half hours that have
   * already happened, producing a schedule whose first three blocks are over
   * before you read it. Only applies to today: a plan built for tomorrow gets
   * its whole window.
   *
   * Rounded up to the next five minutes so the day starts on a readable time
   * rather than at 18:47.
   */
  const now = new Date();
  const isToday = now.toDateString() === dayStart.toDateString();
  const floor = isToday
    ? atMinutes(dayStart, Math.ceil((minutesOfDay(now) + 1) / 5) * 5)
    : null;

  const live = floor
    ? freeWindows.flatMap((window) => {
        if (window.end <= floor) return [];
        if (window.start >= floor) return [window];
        return [
          {
            start: floor,
            end: window.end,
            minutes: Math.round(
              (window.end.getTime() - floor.getTime()) / 60_000,
            ),
          },
        ];
      })
    : freeWindows;

  // Sub-15-minute gaps aren't usable study time.
  const usable = live.filter((window) => window.minutes >= 15);

  return {
    date: dayStart,
    candidates,
    freeWindows: usable,
    totalFreeMinutes: usable.reduce((sum, window) => sum + window.minutes, 0),
    busyTitles: busy.map((block) => block.title),
    scheduleOptions: readScheduleOptions(),
  };
}
