import "server-only";

import { prisma } from "@/lib/prisma";
import { levelForGrade, maxLevel, type StatusLevel } from "@/lib/status";

/**
 * Grade trends (FEATURES.md Tier 1) and the slide detection the struggles
 * engine builds on (Tier 2).
 *
 * Everything here reads `GradeSnapshot`, which the Canvas sync writes one row
 * per course per day. That means a trend only becomes meaningful after a few
 * days of syncing — with fewer than two points there is no direction to report,
 * and this module says so rather than drawing a flat line and implying one.
 */

/** Snapshots older than this aren't the current picture. */
const TREND_WINDOW_DAYS = 45;

/** Percentage points of movement below which a change is just rounding. */
const NOISE_FLOOR = 0.75;

export type TrendDirection = "up" | "down" | "flat" | "unknown";

export interface TrendPoint {
  date: Date;
  gradePercent: number;
}

export interface CourseTrend {
  courseId: string;
  courseName: string;
  currentGradePercent: number | null;
  points: TrendPoint[];
  direction: TrendDirection;
  /** Percentage points gained or lost across the window. */
  changePercent: number | null;
  /** Consecutive snapshots moving down. Two or more is the slide rule. */
  consecutiveDrops: number;
  level: StatusLevel;
}

function startOfWindow(days: number): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start;
}

function directionOf(change: number | null): TrendDirection {
  if (change === null) return "unknown";
  if (change > NOISE_FLOOR) return "up";
  if (change < -NOISE_FLOOR) return "down";
  return "flat";
}

/**
 * How many snapshots in a row moved down, counting back from the latest. This
 * is what "a grade sliding two checks running" in FEATURES.md means, and it is
 * deliberately counted on consecutive *snapshots* rather than days — a weekend
 * with no sync shouldn't reset the count.
 */
function countConsecutiveDrops(points: TrendPoint[]): number {
  let drops = 0;

  for (let i = points.length - 1; i > 0; i -= 1) {
    const delta = points[i].gradePercent - points[i - 1].gradePercent;
    if (delta < -NOISE_FLOOR) drops += 1;
    else break;
  }

  return drops;
}

export async function getCourseTrends(): Promise<CourseTrend[]> {
  const since = startOfWindow(TREND_WINDOW_DAYS);

  const courses = await prisma.course.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      currentGradePercent: true,
      snapshots: {
        where: { date: { gte: since } },
        orderBy: { date: "asc" },
        select: { date: true, gradePercent: true },
      },
    },
  });

  return courses.map((course) => {
    const points: TrendPoint[] = course.snapshots.map((snapshot) => ({
      date: snapshot.date,
      gradePercent: snapshot.gradePercent,
    }));

    // One point is a reading, not a trend. Report "unknown" instead of "flat".
    const change =
      points.length >= 2
        ? points[points.length - 1].gradePercent - points[0].gradePercent
        : null;

    const consecutiveDrops = countConsecutiveDrops(points);

    return {
      courseId: course.id,
      courseName: course.name,
      currentGradePercent: course.currentGradePercent,
      points,
      direction: directionOf(change),
      changePercent: change,
      consecutiveDrops,
      level: maxLevel(
        levelForGrade(course.currentGradePercent),
        // A sliding grade is worth a warning even while the number is still fine.
        consecutiveDrops >= 2 ? "warming" : "calm",
      ),
    };
  });
}

export async function getCourseTrend(
  courseId: string,
): Promise<CourseTrend | null> {
  const trends = await getCourseTrends();
  return trends.find((trend) => trend.courseId === courseId) ?? null;
}
