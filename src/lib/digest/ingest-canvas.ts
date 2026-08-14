import "server-only";

import { CanvasClient } from "@/lib/canvas/client";
import { getCanvasConfig, hasApiCredentials } from "@/lib/canvas/config";
import { prisma } from "@/lib/prisma";
import { DigestSourceKind } from "@/generated/prisma/enums";
import { courseworkExternalId, findCourseworkPage, sliceDay } from "./coursework";
import { extractCourseworkTasks } from "./coursework-tasks";
import { schoolDay } from "./day";
import { htmlToText as toText } from "./html";

/**
 * Pulls what's new in Canvas into digest sources. FEATURES.md: "Canvas content is
 * already directly accessible, no upload needed."
 *
 * Newness is tracked by remembering which module items we've already recorded,
 * not by trusting timestamps — Canvas doesn't reliably expose an updated_at on
 * module items, and an id we've never seen is a sound definition of new.
 */

/** Item types that carry teachable content worth distilling. */
const CONTENT_TYPES = new Set(["Page", "File", "ExternalUrl", "Assignment"]);

export interface CanvasIngestResult {
  coursesScanned: number;
  sourcesAdded: number;
  baselinedCourses: number;
  /** Classes whose daily coursework page had something new on it. */
  courseworkPagesRead: number;
  /** Tasks created from work mentioned on those pages. */
  tasksFromCoursework: number;
  warnings: string[];
}

// Moved to ./html so pure consumers (and their tests) don't have to import a
// server-only module to parse a page body. Re-exported because callers exist.
export { htmlToText } from "./html";

/** `day` must already be a normalised school day — see `schoolDay`. */
export async function ingestCanvasContent(
  day: Date = schoolDay(),
): Promise<CanvasIngestResult> {
  const config = await getCanvasConfig();
  const warnings: string[] = [];

  if (!hasApiCredentials(config)) {
    // The iCal fallback carries due dates only — there is no module content in
    // it, so there is nothing to ingest rather than an error to raise.
    return {
      coursesScanned: 0,
      sourcesAdded: 0,
      baselinedCourses: 0,
      courseworkPagesRead: 0,
      tasksFromCoursework: 0,
      warnings: [
        "Canvas API not configured; module content cannot be read (the iCal fallback has none).",
      ],
    };
  }

  const client = new CanvasClient({
    baseUrl: config.baseUrl!,
    token: config.token!,
  });

  /*
   * Canvas-backed classes only. A class added by hand has no `canvasId` and
   * therefore no modules or pages to scan — asking Canvas about it would be a
   * request for course `null`.
   */
  const courses = (
    await prisma.course.findMany({
      // Hidden classes are enrolments, not classes — homeroom, a club, a
      // district orientation course. Scanning them spent a model call per
      // coursework page on courses the student had explicitly dismissed.
      where: { canvasId: { not: null }, hidden: false },
      select: { id: true, canvasId: true, name: true },
    })
  ).filter(
    (course): course is { id: string; canvasId: number; name: string } =>
      course.canvasId !== null,
  );

  let sourcesAdded = 0;
  let baselinedCourses = 0;
  let courseworkPagesRead = 0;
  let tasksFromCoursework = 0;

  /*
   * The daily coursework page, per class.
   *
   * Runs before the module walk and is deliberately separate from it, because
   * it obeys opposite rules. A module item is new once, identified by its id. A
   * coursework page keeps one id all year and is *rewritten every day*, so it
   * is identified by a hash of the text — which is what makes "has the teacher
   * posted since we last looked" answerable at all.
   *
   * Unlike the module baseline, there is no first-run suppression here. A
   * coursework page read on day one contains that day's work, which is exactly
   * what the digest wants; the baseline rule exists for module trees that carry
   * an entire term of pre-existing material.
   */
  for (const course of courses) {
    try {
      // Both the Pages index and module Page items — this district's template
      // hides the index, and the weekly coursework pages live in modules.
      const page = findCourseworkPage(
        (await client.getAllPageRefs(course.canvasId)).map((ref) => ({
          url: ref.url,
          title: ref.title,
        })),
      );
      if (!page) continue;

      const full = await client.getPage(course.canvasId, page.url);
      if (!full?.body) continue;

      const slice = sliceDay(toText(full.body), day);
      // Empty means the page is split by day and today is not on it yet — the
      // teacher has not posted. Reading the rest would digest the whole term.
      if (slice.text.trim().length < 40) continue;

      const externalId = courseworkExternalId(page.url, slice.text);

      const already = await prisma.digestSource.findUnique({
        where: { externalId },
        select: { id: true },
      });
      if (already) continue;

      await prisma.digestSource.create({
        data: {
          date: day,
          courseId: course.id,
          kind: DigestSourceKind.CANVAS_COURSEWORK,
          externalId,
          label: slice.dated ? `${page.title} (today)` : page.title,
          rawText: slice.text,
        },
      });

      courseworkPagesRead += 1;
      sourcesAdded += 1;

      /*
       * Homework announced on the page becomes a task.
       *
       * Done here rather than at digest time so the work reaches the planner
       * whether or not a digest is ever generated — the student needs the task
       * tonight, and the digest is a separate, optional act.
       */
      try {
        const tasks = await extractCourseworkTasks({
          courseId: course.id,
          text: slice.text,
          day,
        });

        tasksFromCoursework += tasks.created;
      } catch (error) {
        // The page is already recorded and the digest can still use it; failing
        // to read tasks out of it is not worth losing that.
        warnings.push(
          `Couldn't read tasks from "${course.name}" coursework: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } catch (error) {
      warnings.push(
        `Coursework page for "${course.name}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const course of courses) {
    try {
      // Has this course ever been scanned? If not, everything currently in
      // Canvas is pre-existing rather than "covered today".
      const seenCount = await prisma.digestSource.count({
        where: { courseId: course.id, kind: DigestSourceKind.CANVAS_MODULE_ITEM },
      });
      const isBaseline = seenCount === 0;

      const modules = await client.getModules(course.canvasId);

      for (const canvasModule of modules) {
        for (const item of canvasModule.items ?? []) {
          if (!CONTENT_TYPES.has(item.type)) continue;
          if (item.published === false) continue;

          const externalId = `canvas-module-item-${item.id}`;

          // Unique on externalId, so a re-run skips anything already recorded.
          const existing = await prisma.digestSource.findUnique({
            where: { externalId },
            select: { id: true },
          });
          if (existing) continue;

          let body = "";

          // Only Pages have a fetchable body. For everything else the title is
          // the signal that it was added — the digest says so rather than
          // pretending to know the contents.
          if (isBaseline) {
            body = "";
          } else if (item.type === "Page" && item.page_url) {
            const page = await client.getPage(course.canvasId, item.page_url);
            if (page?.body) body = toText(page.body);
          }

          const label = `${canvasModule.name} › ${item.title}`;

          await prisma.digestSource.create({
            data: {
              date: day,
              courseId: course.id,
              kind: DigestSourceKind.CANVAS_MODULE_ITEM,
              externalId,
              label,
              rawText:
                body ||
                `New ${item.type} added to Canvas: "${item.title}" (no readable body).`,
              includeInDigest: !isBaseline,
            },
          });

          if (!isBaseline) sourcesAdded += 1;
        }
      }

      if (isBaseline) baselinedCourses += 1;
    } catch (error) {
      warnings.push(
        `Modules for "${course.name}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Announcements are already synced into their own table; mirror today's into
  // digest sources so the distiller sees them alongside module content.
  const todaysAnnouncements = await prisma.announcement.findMany({
    where: { postedAt: { gte: day } },
    include: { course: { select: { id: true } } },
  });

  for (const announcement of todaysAnnouncements) {
    const externalId = `canvas-announcement-${announcement.canvasId}`;

    const existing = await prisma.digestSource.findUnique({
      where: { externalId },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.digestSource.create({
      data: {
        date: day,
        courseId: announcement.courseId,
        kind: DigestSourceKind.CANVAS_ANNOUNCEMENT,
        externalId,
        label: `Announcement: ${announcement.title}`,
        rawText: announcement.message
          ? toText(announcement.message)
          : announcement.title,
      },
    });

    sourcesAdded += 1;
  }

  return {
    coursesScanned: courses.length,
    sourcesAdded,
    baselinedCourses,
    courseworkPagesRead,
    tasksFromCoursework,
    warnings,
  };
}
