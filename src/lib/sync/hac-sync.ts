import "server-only";

import { fetchHacGradesHtml, HacError } from "@/lib/hac/client";
import { getHacCredentials } from "@/lib/hac/config";
import { parseHacGrades } from "@/lib/hac/parse";
import { normaliseCourseName } from "@/lib/courses/match";
import { prisma } from "@/lib/prisma";

/**
 * Import classes, assignments and grades from Home Access Center.
 *
 * Matching goes through `normaliseCourseName`, because HAC and Canvas share no
 * identifier and dress the same class up differently — Canvas as "AP Pre
 * Calculus YR (GIPSON, HANNAH)", HAC as "MTH34300A - 3 AP Pre Calculus S1".
 * Comparing raw names meant every class existed twice, once per source, each
 * holding half the information.
 *
 * A class HAC knows about and Canvas does not is created with a null
 * `canvasId`, which is what keeps a later Canvas sync from touching it.
 *
 * ## Assignments are owned by HAC, not the student
 *
 * They are written with `source: HAC` rather than `MANUAL`, so they carry no
 * delete or complete controls: HAC re-imports them on every sync, and a row the
 * student deleted would simply come back. Their identity is course + title,
 * which is the only stable pair the page exposes — there is no assignment id in
 * the markup.
 */

export interface HacSyncResult {
  status: "SUCCESS" | "FAILED";
  coursesMatched: number;
  coursesCreated: number;
  gradesUpdated: number;
  assignmentsImported: number;
  assignmentsUpdated: number;
  /** Canvas enrolments hidden because HAC does not list them as classes. */
  coursesHidden: number;
  /** True when HAC showed no averages at all — normal early in a term. */
  noGradesPosted: boolean;
  message: string;
}

const failure = (message: string): HacSyncResult => ({
  status: "FAILED",
  coursesMatched: 0,
  coursesCreated: 0,
  gradesUpdated: 0,
  assignmentsImported: 0,
  assignmentsUpdated: 0,
  coursesHidden: 0,
  noGradesPosted: false,
  message,
});

export async function runHacSync(): Promise<HacSyncResult> {
  const credentials = await getHacCredentials();
  if (!credentials) return failure("HAC isn't connected.");

  let courses;

  try {
    courses = parseHacGrades(await fetchHacGradesHtml(credentials));
  } catch (error) {
    return failure(
      error instanceof HacError || error instanceof Error
        ? error.message
        : String(error),
    );
  }

  if (courses.length === 0) {
    return failure(
      "Signed in, but no classes could be read from the page. Your district's HAC layout is probably different.",
    );
  }

  const existing = await prisma.course.findMany({
    select: { id: true, name: true, canvasId: true },
  });

  // Normalised on both sides, so a HAC class lands on the Canvas course that
  // already represents it rather than creating a second one beside it.
  const byName = new Map(
    existing.map((course) => [normaliseCourseName(course.name), course.id]),
  );

  const now = new Date();
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );

  /** Every course HAC actually named, so the rest can be put away. */
  const inHac = new Set<string>();

  let matched = 0;
  let created = 0;
  let gradesUpdated = 0;
  let imported = 0;
  let updated = 0;

  for (const course of courses) {
    const key = normaliseCourseName(course.name);
    let courseId = byName.get(key);

    if (courseId) {
      matched += 1;
    } else {
      const record = await prisma.course.create({ data: { name: course.name } });
      courseId = record.id;
      byName.set(key, courseId);
      created += 1;
    }

    inHac.add(courseId);

    /*
     * A blank average is a real state, not a failure: HAC hides averages when
     * the Report Card Run is "(All Runs)", and nothing is marked at the start
     * of a term anyway. Writing it as a zero would put a fabricated grade into
     * the trend, so it is left alone.
     */
    if (course.percent !== null) {
      await prisma.$transaction([
        prisma.course.update({
          where: { id: courseId },
          data: { currentGradePercent: course.percent },
        }),
        prisma.gradeSnapshot.upsert({
          where: { courseId_date: { courseId, date: today } },
          create: { courseId, date: today, gradePercent: course.percent },
          update: { gradePercent: course.percent },
        }),
      ]);
      gradesUpdated += 1;
    }

    for (const assignment of course.assignments) {
      // Without a due date an assignment is invisible everywhere in this app —
      // every list filters on `dueAt` — so importing one would be storing a row
      // nobody can ever see.
      if (!assignment.dueAt) continue;

      const found = await prisma.assignment.findFirst({
        where: { courseId, title: assignment.title },
        select: { id: true, source: true },
      });

      /*
       * Canvas wins where both describe the same piece of work.
       *
       * Canvas carries points, submission state and a link back to the real
       * assignment; HAC carries a title and a date. Overwriting a Canvas row
       * with the thinner HAC version would lose all of that, so an existing
       * non-HAC assignment is left exactly as it is.
       */
      if (found && found.source !== "HAC") continue;

      // A score means it has been marked, which is the closest thing HAC gives
      // to Canvas's submitted flag.
      const data = {
        dueAt: assignment.dueAt,
        pointsPossible: assignment.pointsPossible,
        score: assignment.score,
        submitted: assignment.score !== null,
      };

      if (found) {
        await prisma.assignment.update({ where: { id: found.id }, data });
        updated += 1;
      } else {
        await prisma.assignment.create({
          data: { ...data, courseId, title: assignment.title, source: "HAC" },
        });
        imported += 1;
      }
    }
  }

  /*
   * HAC decides which classes are real.
   *
   * A Canvas enrolment is not a class. Homeroom, DECA, a district-wide
   * orientation course and the school's activities page all arrive as courses,
   * and so does last year's version of a class the student has since moved on
   * from. HAC lists exactly the classes on the timetable, so anything Canvas
   * offers that HAC does not name is put away.
   *
   * Hidden, never deleted: the next Canvas sync would recreate the row anyway,
   * and hiding is reversible from the Classes page.
   *
   * Two guards. Courses added by hand are left alone — HAC has no opinion about
   * a class the student created themselves. And nothing is hidden unless HAC
   * returned a plausible timetable, because a partial parse that found one
   * class must not sweep everything else out of sight.
   */
  let hidden = 0;

  if (courses.length >= 3) {
    const stale = existing.filter(
      (course) => course.canvasId !== null && !inHac.has(course.id),
    );

    if (stale.length > 0) {
      const result = await prisma.course.updateMany({
        where: { id: { in: stale.map((course) => course.id) }, hidden: false },
        data: { hidden: true },
      });
      hidden = result.count;
    }

    // Anything HAC *does* list belongs on screen, even if it was hidden before.
    await prisma.course.updateMany({
      where: { id: { in: [...inHac] }, hidden: true },
      data: { hidden: false },
    });
  }

  const noGradesPosted = gradesUpdated === 0;

  const parts = [
    `${matched + created} class${matched + created === 1 ? "" : "es"}`,
    created > 0 ? `${created} new` : null,
    imported > 0 ? `${imported} assignment${imported === 1 ? "" : "s"} imported` : null,
    updated > 0 ? `${updated} updated` : null,
    hidden > 0
      ? `${hidden} non-class enrolment${hidden === 1 ? "" : "s"} hidden`
      : null,
    gradesUpdated > 0
      ? `${gradesUpdated} grade${gradesUpdated === 1 ? "" : "s"}`
      : "no grades posted yet",
  ].filter(Boolean);

  return {
    status: "SUCCESS",
    coursesMatched: matched,
    coursesCreated: created,
    gradesUpdated,
    assignmentsImported: imported,
    assignmentsUpdated: updated,
    coursesHidden: hidden,
    noGradesPosted,
    message: parts.join(" · "),
  };
}
