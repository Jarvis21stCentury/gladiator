import "server-only";

import { createEstimator } from "@/lib/effort/estimate";
import { prisma } from "@/lib/prisma";
import { levelForLoad, type StatusLevel } from "@/lib/status";

/**
 * The two-week workload forecast (FEATURES.md Tier 2) — "which days are about
 * to get brutal, before it's a surprise".
 *
 * The unit is minutes, not assignment count. Four reading checks and one
 * research paper land on the calendar as five items either way; only minutes
 * tell you which day is actually the problem.
 *
 * Nothing here calls a model. It is arithmetic over due dates and effort
 * estimates, which means the pressure chart and the verdict keep working with no API key
 * configured — the dashboard's most load-bearing element should not depend on a
 * third party being reachable.
 */

export const FORECAST_DAYS = 14;

/**
 * Study minutes assumed available on a day, before commitments are subtracted.
 * Weekends get more; a school night realistically has one evening block. Same
 * default window as the planner (16:00–21:30 ≈ 330 min).
 */
const WEEKDAY_CAPACITY = 330;
const WEEKEND_CAPACITY = 480;

export interface ForecastItem {
  assignmentId: string;
  title: string;
  courseName: string;
  courseId: string;
  dueAt: Date;
  estimatedMinutes: number;
  pointsPossible: number | null;
}

export interface ForecastDay {
  date: Date;
  /** 0 = today. Negative never appears; the forecast starts at today. */
  offset: number;
  items: ForecastItem[];
  /** Minutes of work due on this day. */
  loadMinutes: number;
  /** Minutes available after existing calendar commitments. */
  capacityMinutes: number;
  /** loadMinutes ÷ capacityMinutes. Above 1 means the day does not fit. */
  loadRatio: number;
  level: StatusLevel;
  /** 0–1, for glow intensity. Normalised across the window, not absolute. */
  intensity: number;
}

export interface WorkloadForecast {
  days: ForecastDay[];
  totalMinutes: number;
  /** The worst day in the window, or null when nothing is due at all. */
  peak: ForecastDay | null;
  /** Days whose load exceeds capacity. */
  overloadedDays: ForecastDay[];
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function baseCapacity(date: Date): number {
  const day = date.getDay();
  return day === 0 || day === 6 ? WEEKEND_CAPACITY : WEEKDAY_CAPACITY;
}

export async function getWorkloadForecast(
  from: Date = new Date(),
  /** Window length. The calendar rail asks for a longer one than the radar. */
  dayCount: number = FORECAST_DAYS,
): Promise<WorkloadForecast> {
  const today = startOfDay(from);
  const horizon = addDays(today, dayCount);

  const [assignments, blocks, estimator] = await Promise.all([
    prisma.assignment.findMany({
      where: {
        submitted: false,
        dueAt: { gte: today, lt: horizon },
      },
      orderBy: { dueAt: "asc" },
      include: { course: { select: { id: true, name: true } } },
    }),
    // Real commitments only. ASSIGNMENT blocks are the 30-minute deadline
    // markers this app writes to Google Calendar; counting them as busy would
    // subtract the very work being forecast.
    prisma.calendarBlock.findMany({
      where: {
        start: { gte: today, lt: horizon },
        type: { not: "ASSIGNMENT" },
        deletedInGoogle: false,
      },
      select: { start: true, end: true },
    }),
    createEstimator(),
  ]);

  const days: ForecastDay[] = Array.from({ length: dayCount }, (_, offset) => {
    const date = addDays(today, offset);
    return {
      date,
      offset,
      items: [],
      loadMinutes: 0,
      capacityMinutes: baseCapacity(date),
      loadRatio: 0,
      level: "calm" as StatusLevel,
      intensity: 0,
    };
  });

  const indexOf = (date: Date): number =>
    Math.floor((startOfDay(date).getTime() - today.getTime()) / 86_400_000);

  for (const assignment of assignments) {
    if (!assignment.dueAt) continue;

    const index = indexOf(assignment.dueAt);
    if (index < 0 || index >= days.length) continue;

    const { minutes } = estimator.estimate(assignment);

    days[index].items.push({
      assignmentId: assignment.id,
      title: assignment.title,
      courseName: assignment.course.name,
      courseId: assignment.course.id,
      dueAt: assignment.dueAt,
      estimatedMinutes: minutes,
      pointsPossible: assignment.pointsPossible,
    });
    days[index].loadMinutes += minutes;
  }

  for (const block of blocks) {
    const index = indexOf(block.start);
    if (index < 0 || index >= days.length) continue;

    const busyMinutes = Math.max(
      0,
      (block.end.getTime() - block.start.getTime()) / 60_000,
    );

    // Floor at 60 minutes: a day packed with commitments still has *some* time,
    // and a zero capacity would divide into an infinite load ratio.
    days[index].capacityMinutes = Math.max(
      60,
      days[index].capacityMinutes - busyMinutes,
    );
  }

  const busiest = Math.max(...days.map((day) => day.loadMinutes), 0);

  for (const day of days) {
    day.loadRatio = day.loadMinutes / day.capacityMinutes;
    day.level = levelForLoad(day.loadRatio);
    // Normalised against the busiest day in view, so the radar always has
    // contrast — an absolute scale renders a quiet fortnight as fourteen dark
    // rings, which tells the user nothing.
    day.intensity = busiest > 0 ? day.loadMinutes / busiest : 0;
  }

  const withWork = days.filter((day) => day.loadMinutes > 0);

  return {
    days,
    totalMinutes: days.reduce((sum, day) => sum + day.loadMinutes, 0),
    peak:
      withWork.length > 0
        ? withWork.reduce((worst, day) =>
            day.loadRatio > worst.loadRatio ? day : worst,
          )
        : null,
    overloadedDays: days.filter((day) => day.loadRatio >= 1),
  };
}
