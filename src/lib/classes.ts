import "server-only";

import { getCourseTrends, type CourseTrend } from "@/lib/analytics/trend";
import { createEstimator } from "@/lib/effort/estimate";
import type { AssignmentSource, GradeSource } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  currentGradingPeriod,
  withinGradingPeriod,
  type GradingPeriod,
} from "@/lib/grading-period";
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
  /** Which system posted that grade. Null when there is none. */
  gradeSource: GradeSource | null;
  /** False for a class added by hand — a sync will never touch it. */
  fromCanvas: boolean;
  /** True when HAC knows this class at all, so the page can say why it has no average. */
  fromHac: boolean;
  /** Nightly digest notes written for this class, all time. */
  noteCount: number;
  /** The most recent day this class has a digest note for. */
  latestNoteDate: Date | null;
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
  /**
   * Unfinished work outside the current nine weeks, so scoping the page to one
   * marking period never *hides* anything — it only stops leading with it.
   */
  outstandingLater: number;
  overdueEarlier: number;
  /** True when this class has nothing at all in the current period. */
  quiet: boolean;
}

export interface ClassesView {
  /** The nine weeks everything below is scoped to. */
  period: GradingPeriod;
  classes: ClassView[];
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

export async function getClassViews(): Promise<ClassesView> {
  const now = new Date();

  const year = await getSchoolYear();
  const period = currentGradingPeriod(year, now);

  /** Unfinished work in the year but outside this period, on one side or the other. */
  const outsidePeriod = (side: "before" | "after") =>
    prisma.assignment.groupBy({
      by: ["courseId"],
      where: {
        submitted: false,
        course: { hidden: false },
        dueAt:
          side === "before" ? { lt: period.start } : { gt: period.end },
        AND: withinSchoolYear(year),
      },
      _count: { _all: true },
    });

  const [courses, trends, struggles, estimator, earlier, later, hacKnown] =
    await Promise.all([
    prisma.course.findMany({
      // Hidden classes are enrolments, not classes — see Course.hidden.
      where: { hidden: false },
      orderBy: { name: "asc" },
      include: {
        assignments: {
          /*
           * The current nine weeks only, and nothing undated.
           *
           * This used to be "the school year, minus a 21-day lookback", which
           * produced a page nobody could read: eight classes' worth of work
           * from August to May in one column. A Texas grade is a fact about one
           * marking period and resets when it closes, so the period is the
           * honest unit — and it means the page rolls itself over every nine
           * weeks instead of growing all year.
           *
           * Undated work is excluded by the bound and that is intended: Canvas
           * carries 111 undated rows here, and an assignment with no date
           * cannot be late, planned or scheduled.
           */
          where: { AND: withinGradingPeriod(period) },
          orderBy: { dueAt: "asc" },
          include: {
            gradeCategory: { select: { name: true } },
            effortLogs: { select: { actualMinutes: true } },
          },
        },
        gradeCategories: { orderBy: { weightPercent: "desc" } },
        syllabusImports: { orderBy: { createdAt: "desc" }, take: 1 },
        // Enough to link straight to this class's most recent digest, and to
        // say how much there is to read, without loading any note bodies.
        lessonNotes: {
          orderBy: { date: "desc" },
          take: 1,
          select: { date: true },
        },
        _count: { select: { lessonNotes: true } },
      },
    }),
    getCourseTrends(),
    getActiveStruggles(),
    createEstimator(),
    /*
     * Unfinished work in the rest of the year, counted per class.
     *
     * Scoping a page to one period is only safe if it can still say what it is
     * not showing. Without these, work due in November would simply be absent
     * in October with nothing to indicate it existed — the same silent-omission
     * failure as the sidebar reporting a count its own page contradicted.
     */
    outsidePeriod("before"),
    outsidePeriod("after"),
    /*
     * Which classes HAC knows about.
     *
     * There is no `hacId` on Course — HAC is matched by name — so the honest
     * test is whether the scraper has ever written an assignment for it. It
     * lets the page distinguish the two reasons a grade is missing: HAC has
     * this class and has not posted an average yet, versus HAC has never heard
     * of it. Those need different sentences and the student can only act on one.
     */
    prisma.assignment.groupBy({
      by: ["courseId"],
      where: { source: "HAC" },
      _count: { _all: true },
    }),
  ]);

  const countBy = (rows: { courseId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.courseId, row._count._all]));

  const earlierByCourse = countBy(earlier);
  const laterByCourse = countBy(later);
  const hacCourses = new Set(hacKnown.map((row) => row.courseId));

  const classes = courses.map((course) => {
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
      gradeSource: course.gradeSource,
      fromCanvas: course.canvasId !== null,
      fromHac: hacCourses.has(course.id),
      noteCount: course._count.lessonNotes,
      latestNoteDate: course.lessonNotes[0]?.date ?? null,
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
      outstandingLater: laterByCourse.get(course.id) ?? 0,
      overdueEarlier: earlierByCourse.get(course.id) ?? 0,
      /*
       * Nothing to say about this class right now. The page uses this to
       * collapse it to a single line instead of printing a full dossier of
       * empty scaffolding — which is what eight untouched classes looked like
       * on the first day of term, and why this page became unreadable.
       */
      quiet:
        upcoming.length === 0 &&
        recent.length === 0 &&
        courseStruggles.length === 0 &&
        course.currentGradePercent === null,
    };
  });

  return { period, classes };
}
