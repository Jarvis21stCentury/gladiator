import "server-only";

import { getCourseTrends, type CourseTrend } from "@/lib/analytics/trend";
import { createEstimator } from "@/lib/effort/estimate";
import { prisma } from "@/lib/prisma";
import { levelForDueDate, levelForGrade, maxLevel, type StatusLevel } from "@/lib/status";
import { getActiveStruggles, type ActiveStruggle } from "@/lib/struggles/engine";

/**
 * Everything the Classes page draws, gathered per course.
 *
 * The one piece of derived state that matters here is `level` — the colour of
 * that class's ink in the ledger. It is the worst of three things: the grade,
 * whether anything is overdue, and whether the struggles engine has flagged the
 * class. A class that stayed in plain ink while three assignments sat overdue would be
 * actively misleading, which is the failure mode the whole colour language
 * exists to avoid.
 */

/** Recent past work stays visible so it can have effort logged against it. */
const LOOKBACK_DAYS = 21;

export interface ClassAssignment {
  id: string;
  title: string;
  dueAt: Date | null;
  pointsPossible: number | null;
  score: number | null;
  submitted: boolean;
  estimatedMinutes: number;
  level: StatusLevel;
  categoryName: string | null;
  fromSyllabus: boolean;
  loggedMinutes: number | null;
}

export interface ClassView {
  id: string;
  name: string;
  term: string | null;
  currentGradePercent: number | null;
  level: StatusLevel;
  trend: CourseTrend | null;
  struggles: ActiveStruggle[];
  upcoming: ClassAssignment[];
  recent: ClassAssignment[];
  overdueCount: number;
  categories: { id: string; name: string; weightPercent: number }[];
  lastSyllabusImport: { fileName: string; createdAt: Date; datesFound: number } | null;
  /** Minutes logged against this class, all time. */
  minutesLogged: number;
}

export async function getClassViews(): Promise<ClassView[]> {
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const [courses, trends, struggles, estimator] = await Promise.all([
    prisma.course.findMany({
      orderBy: { name: "asc" },
      include: {
        assignments: {
          where: {
            OR: [{ dueAt: { gte: since } }, { dueAt: null }],
          },
          orderBy: { dueAt: "asc" },
          include: {
            gradeCategory: { select: { name: true } },
            effortLogs: { select: { actualMinutes: true } },
          },
        },
        gradeCategories: { orderBy: { weightPercent: "desc" } },
        syllabusImports: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    getCourseTrends(),
    getActiveStruggles(),
    createEstimator(),
  ]);

  return courses.map((course) => {
    const assignments: ClassAssignment[] = course.assignments.map((assignment) => {
      const loggedMinutes = assignment.effortLogs.reduce(
        (sum, log) => sum + log.actualMinutes,
        0,
      );

      return {
        id: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        pointsPossible: assignment.pointsPossible,
        score: assignment.score,
        submitted: assignment.submitted,
        estimatedMinutes: estimator.estimate(assignment).minutes,
        level: levelForDueDate(assignment.dueAt, {
          submitted: assignment.submitted,
          now,
        }),
        categoryName: assignment.gradeCategory?.name ?? null,
        fromSyllabus: assignment.source === "SYLLABUS",
        loggedMinutes: loggedMinutes > 0 ? loggedMinutes : null,
      };
    });

    // "Upcoming" includes overdue-and-unsubmitted: it is still outstanding work
    // and burying it in a "recent" list is how it gets forgotten.
    const upcoming = assignments.filter(
      (assignment) =>
        !assignment.submitted &&
        (assignment.dueAt === null || assignment.dueAt >= now || assignment.level === "urgent"),
    );

    const recent = assignments
      .filter((assignment) => !upcoming.includes(assignment))
      .reverse();

    const courseStruggles = struggles.filter(
      (struggle) => struggle.courseId === course.id,
    );

    const overdueCount = assignments.filter(
      (assignment) =>
        !assignment.submitted && assignment.dueAt !== null && assignment.dueAt < now,
    ).length;

    return {
      id: course.id,
      name: course.name,
      term: course.term,
      currentGradePercent: course.currentGradePercent,
      level: maxLevel(
        levelForGrade(course.currentGradePercent),
        overdueCount > 0 ? "urgent" : "calm",
        ...courseStruggles.map((struggle) => struggle.level),
      ),
      trend: trends.find((entry) => entry.courseId === course.id) ?? null,
      struggles: courseStruggles,
      upcoming,
      recent: recent.slice(0, 12),
      overdueCount,
      categories: course.gradeCategories.map((category) => ({
        id: category.id,
        name: category.name,
        weightPercent: category.weightPercent,
      })),
      lastSyllabusImport: course.syllabusImports[0]
        ? {
            fileName: course.syllabusImports[0].fileName,
            createdAt: course.syllabusImports[0].createdAt,
            datesFound: course.syllabusImports[0].datesFound,
          }
        : null,
      minutesLogged: assignments.reduce(
        (sum, assignment) => sum + (assignment.loggedMinutes ?? 0),
        0,
      ),
    };
  });
}
