import "server-only";

import { prisma } from "@/lib/prisma";
import { levelForDueDate, maxLevel, type StatusLevel } from "@/lib/status";
import { getWorkloadForecast, type ForecastDay } from "@/lib/workload/forecast";

/**
 * Data for the orbit rail (FEATURES.md, Calendar): "no month grid — a
 * horizontal timeline rail with day-nodes that glow brighter/warmer the busier
 * that day is; clicking a node zooms into a HUD-style day view."
 *
 * The rail is the workload forecast over a longer window, so brightness on the
 * rail and blip intensity on the dashboard radar are the same number. The day
 * view adds what the forecast deliberately leaves out: the actual commitments
 * on the calendar, which are what make a day's remaining hours what they are.
 */

/** Three weeks reads as a horizon without the rail nodes becoming unhittable. */
export const RAIL_DAYS = 21;

export interface DayCommitment {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: string;
  /** True for the 30-minute deadline markers this app writes to Google. */
  isDeadlineMarker: boolean;
  userModified: boolean;
}

export interface DayDetail {
  date: Date;
  forecast: ForecastDay | null;
  commitments: DayCommitment[];
  /** Everything due that day, submitted included — the day view is a record. */
  due: {
    id: string;
    title: string;
    courseName: string;
    dueAt: Date | null;
    submitted: boolean;
    pointsPossible: number | null;
    level: StatusLevel;
    /** The student's own 1–5 rating, so the day view can set it too. */
    difficulty: number | null;
  }[];
  level: StatusLevel;
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** `YYYY-MM-DD` in local time — the format the rail links use. */
export function formatDayParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse `?day=`. Midday is used deliberately: constructing a local date from a
 * bare `YYYY-MM-DD` via `new Date()` parses as UTC and lands on the previous
 * day for anyone west of Greenwich.
 */
export function parseDayParam(raw: string | null | undefined): Date {
  if (!raw) return startOfDay(new Date());

  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return startOfDay(new Date());

  return startOfDay(parsed);
}

export async function getDayDetail(date: Date): Promise<DayDetail> {
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [assignments, blocks, forecast] = await Promise.all([
    prisma.assignment.findMany({
      where: { dueAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { dueAt: "asc" },
      include: { course: { select: { name: true } } },
    }),
    prisma.calendarBlock.findMany({
      where: { start: { gte: dayStart, lt: dayEnd }, deletedInGoogle: false },
      orderBy: { start: "asc" },
    }),
    // Only needed when the day is inside the forecast window; a past day simply
    // has no forecast, and the view says so rather than inventing one.
    getWorkloadForecast(new Date(), RAIL_DAYS),
  ]);

  const due = assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    courseName: assignment.course.name,
    dueAt: assignment.dueAt,
    submitted: assignment.submitted,
    pointsPossible: assignment.pointsPossible,
    level: levelForDueDate(assignment.dueAt, { submitted: assignment.submitted }),
    difficulty: assignment.difficulty,
  }));

  const forecastDay =
    forecast.days.find(
      (day) => startOfDay(day.date).getTime() === dayStart.getTime(),
    ) ?? null;

  return {
    date: dayStart,
    forecast: forecastDay,
    commitments: blocks.map((block) => ({
      id: block.id,
      title: block.title,
      start: block.start,
      end: block.end,
      type: block.type,
      isDeadlineMarker: block.type === "ASSIGNMENT",
      userModified: block.userModified,
    })),
    due,
    level: maxLevel(
      forecastDay?.level ?? "calm",
      ...due.map((item) => item.level),
    ),
  };
}

export async function getRail(): Promise<ForecastDay[]> {
  const forecast = await getWorkloadForecast(new Date(), RAIL_DAYS);
  return forecast.days;
}
