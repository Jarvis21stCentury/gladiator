import "server-only";

import { createEstimator, type EffortSource } from "@/lib/effort/estimate";
import { prisma } from "@/lib/prisma";

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

  const [assignments, estimator] = await Promise.all([
    prisma.assignment.findMany({
      where: {
        submitted: false,
        dueAt: { not: null, lt: horizon },
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

  const windowStart = readWindow("PLAN_WINDOW_START", DEFAULT_WINDOW_START);
  const windowEnd = readWindow("PLAN_WINDOW_END", DEFAULT_WINDOW_END);

  const freeWindows: FreeWindow[] = [];
  let cursor = windowStart;

  for (const block of busy) {
    const blockStart = Math.max(windowStart, minutesOfDay(block.start));
    const blockEnd = Math.min(windowEnd, minutesOfDay(block.end));

    if (blockEnd <= cursor) continue;

    if (blockStart > cursor) {
      freeWindows.push({
        start: atMinutes(dayStart, cursor),
        end: atMinutes(dayStart, blockStart),
        minutes: blockStart - cursor,
      });
    }

    cursor = Math.max(cursor, blockEnd);
  }

  if (cursor < windowEnd) {
    freeWindows.push({
      start: atMinutes(dayStart, cursor),
      end: atMinutes(dayStart, windowEnd),
      minutes: windowEnd - cursor,
    });
  }

  // Sub-15-minute gaps aren't usable study time.
  const usable = freeWindows.filter((window) => window.minutes >= 15);

  return {
    date: dayStart,
    candidates,
    freeWindows: usable,
    totalFreeMinutes: usable.reduce((sum, window) => sum + window.minutes, 0),
    busyTitles: busy.map((block) => block.title),
  };
}
