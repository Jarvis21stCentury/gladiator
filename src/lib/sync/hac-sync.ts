import "server-only";

import { fetchHacGradesHtml, HacError } from "@/lib/hac/client";
import { getHacCredentials } from "@/lib/hac/config";
import { parseHacGrades } from "@/lib/hac/parse";
import { prisma } from "@/lib/prisma";

/**
 * Pull grades from HAC into the classes this app already knows about.
 *
 * Matching is by name, case-insensitively, because HAC and Canvas have no
 * shared identifier — they are separate systems that happen to describe the
 * same six classes. `tidyCourseName` strips the district course code first, so
 * "1234 - AP Calculus AB" in HAC lines up with "AP Calculus AB" from Canvas.
 *
 * A class HAC knows about and Canvas does not is created, with a null
 * `canvasId` — the same shape as one added by hand, and therefore untouched by
 * a Canvas sync.
 */

export interface HacSyncResult {
  status: "SUCCESS" | "FAILED";
  coursesMatched: number;
  coursesCreated: number;
  gradesUpdated: number;
  /** Names HAC returned with no percent — reported rather than silently ignored. */
  withoutGrades: string[];
  message: string;
}

export async function runHacSync(): Promise<HacSyncResult> {
  const credentials = await getHacCredentials();

  if (!credentials) {
    return {
      status: "FAILED",
      coursesMatched: 0,
      coursesCreated: 0,
      gradesUpdated: 0,
      withoutGrades: [],
      message: "HAC isn't connected.",
    };
  }

  let courses;

  try {
    courses = parseHacGrades(await fetchHacGradesHtml(credentials));
  } catch (error) {
    return {
      status: "FAILED",
      coursesMatched: 0,
      coursesCreated: 0,
      gradesUpdated: 0,
      withoutGrades: [],
      message:
        error instanceof HacError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }

  if (courses.length === 0) {
    return {
      status: "FAILED",
      coursesMatched: 0,
      coursesCreated: 0,
      gradesUpdated: 0,
      withoutGrades: [],
      message:
        "Signed in, but no classes could be read from the page. Your district's HAC layout is probably different — the parser needs a look at it.",
    };
  }

  const existing = await prisma.course.findMany({
    select: { id: true, name: true },
  });
  const byName = new Map(
    existing.map((course) => [course.name.trim().toLowerCase(), course.id]),
  );

  const now = new Date();
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );

  let matched = 0;
  let created = 0;
  let updated = 0;
  const withoutGrades: string[] = [];

  for (const course of courses) {
    let courseId = byName.get(course.name.toLowerCase());

    if (courseId) {
      matched += 1;
    } else {
      const record = await prisma.course.create({
        data: { name: course.name },
      });
      courseId = record.id;
      byName.set(course.name.toLowerCase(), courseId);
      created += 1;
    }

    // A class with no posted percent is a real state — nothing graded yet. It
    // is reported, not written as a zero.
    if (course.percent === null) {
      withoutGrades.push(course.name);
      continue;
    }

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

    updated += 1;
  }

  return {
    status: "SUCCESS",
    coursesMatched: matched,
    coursesCreated: created,
    gradesUpdated: updated,
    withoutGrades,
    message: `Updated ${updated} grade${updated === 1 ? "" : "s"}${
      created > 0 ? `, added ${created} class${created === 1 ? "" : "es"}` : ""
    }.`,
  };
}
