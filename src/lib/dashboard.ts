import "server-only";

import type { AssignmentSource } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Day boundaries use the server's local time. On Vercel that is UTC, which will
 * push "today" forward for a US-timezone user late in the evening — worth pinning
 * to an explicit school timezone once the daily plan depends on it.
 */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** End of the current week, treating Sunday as the last day. */
function endOfWeek(from: Date): Date {
  const daysUntilSunday = (7 - from.getDay()) % 7;
  return addDays(from, daysUntilSunday + 1);
}

export interface DueItem {
  id: string;
  title: string;
  dueAt: Date | null;
  pointsPossible: number | null;
  courseName: string;
  /**
   * Where the row came from. The UI needs it to decide whether to offer the
   * complete and delete controls: only `MANUAL` rows are yours to change, since
   * Canvas owns `submitted` on its own and would overwrite it on the next sync.
   */
  source: AssignmentSource;
  /** The student's own 1–5 rating, or null. */
  difficulty: number | null;
}

async function findDue(from: Date, to?: Date): Promise<DueItem[]> {
  const assignments = await prisma.assignment.findMany({
    where: {
      // Already-submitted work isn't a to-do. In the iCal fallback nothing is
      // ever marked submitted, so everything stays visible there.
      submitted: false,
      dueAt: to ? { gte: from, lt: to } : { gte: from },
      // Homeroom has no homework; its "assignments" are not work.
      course: { hidden: false },
    },
    orderBy: { dueAt: "asc" },
    take: 50,
    include: { course: { select: { name: true } } },
  });

  return assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    dueAt: assignment.dueAt,
    pointsPossible: assignment.pointsPossible,
    courseName: assignment.course.name,
    source: assignment.source,
    difficulty: assignment.difficulty,
  }));
}

export async function getDashboardData() {
  const today = startOfToday();
  const tomorrow = addDays(today, 1);
  const weekEnd = endOfWeek(today);

  const [
    dueToday,
    dueThisWeek,
    upcoming,
    courses,
    lastCanvasSync,
    lastCalendarSync,
    overdue,
  ] = await Promise.all([
      findDue(today, tomorrow),
      findDue(tomorrow, weekEnd),
      findDue(weekEnd),
      prisma.course.findMany({
        where: { hidden: false },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          term: true,
          currentGradePercent: true,
          _count: { select: { assignments: true } },
        },
      }),
    // Scoped by mode on purpose: a Google Calendar run is the most recent
    // SyncRun most of the time, and it says nothing about whether Canvas data
    // came from the API or the grade-less iCal fallback.
    prisma.syncRun.findFirst({
      where: { mode: { in: ["CANVAS_API", "ICAL_FALLBACK"] } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.syncRun.findFirst({
      where: { mode: "GOOGLE_CALENDAR" },
      orderBy: { startedAt: "desc" },
    }),
    findDue(new Date(0), today),
  ]);

  return {
    dueToday,
    dueThisWeek,
    // "Upcoming deadlines" is a peek ahead, not the full backlog.
    upcoming: upcoming.slice(0, 10),
    overdue,
    courses,
    lastCanvasSync,
    lastCalendarSync,
  };
}
