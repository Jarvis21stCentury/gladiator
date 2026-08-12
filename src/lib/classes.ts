import "server-only";

import { getCourseTrends, type CourseTrend } from "@/lib/analytics/trend";
import { createEstimator } from "@/lib/effort/estimate";
import type { AssignmentSource } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getSchoolYear, withinSchoolYear } from "@/lib/school-year";
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
  /**
   * Where the row came from. `MANUAL` rows are the student's own tasks and are
   * the only ones the UI may offer complete/delete controls for — Canvas owns
   * `submitted` on its rows and would overwrite a local change on the next sync.
   */
  source: AssignmentSource;
  difficulty: number | null;
  loggedMinutes: number | null;
}

export interface ClassView {
  id: string;
  name: string;
  term: string | null;
  currentGradePercent: number | null;
  /** False for a class added by hand — a sync will never touch it. */
  fromCanvas: boolean;
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

/** Classes that have been hidden, so the page can offer them back. */
export async function getHiddenCourses(): Promise<
  { id: string; name: string }[]
> {
  return prisma.course.findMany({
    where: { hidden: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function getClassViews(): Promise<ClassView[]> {
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const year = await getSchoolYear();

  const [courses, trends, struggles, estimator] = await Promise.all([
    prisma.course.findMany({
      // Hidden classes are enrolments, not classes — see Course.hidden.
      where: { hidden: false },
      orderBy: { name: "asc" },
      include: {
        assignments: {
          /*
           * This school year only, and nothing undated.
           *
           * Canvas hands over every assignment from every course a student has
           * ever been enrolled in — here, 204 of them, 56 due before this year
           * started and 111 with no due date at all. A dossier listing four
           * years of history is not a dossier, and an undated assignment cannot
           * be late, planned or scheduled; every list in this product keys off
           * a due date.
           */
          where: {
            dueAt: { gte: since },
            AND: withinSchoolYear(year),
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
        source: assignment.source,
        difficulty: assignment.difficulty,
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
      fromCanvas: course.canvasId !== null,
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
