import "server-only";

import { CanvasClient } from "@/lib/canvas/client";
import { getCanvasConfig, hasApiCredentials } from "@/lib/canvas/config";
import { prisma } from "@/lib/prisma";
import { DigestSourceKind } from "@/generated/prisma/enums";
import { schoolDay } from "./day";

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
  warnings: string[];
}

/** Canvas page bodies are HTML; the model wants readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `day` must already be a normalised school day — see `schoolDay`. */
export async function ingestCanvasContent(
  day: Date = schoolDay(),
): Promise<CanvasIngestResult> {
  const config = getCanvasConfig();
  const warnings: string[] = [];

  if (!hasApiCredentials(config)) {
    // The iCal fallback carries due dates only — there is no module content in
    // it, so there is nothing to ingest rather than an error to raise.
    return {
      coursesScanned: 0,
      sourcesAdded: 0,
      baselinedCourses: 0,
      warnings: [
        "Canvas API not configured; module content cannot be read (the iCal fallback has none).",
      ],
    };
  }

  const client = new CanvasClient({
    baseUrl: config.baseUrl!,
    token: config.token!,
  });

  const courses = await prisma.course.findMany({
    select: { id: true, canvasId: true, name: true },
  });

  let sourcesAdded = 0;
  let baselinedCourses = 0;

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
            if (page?.body) body = htmlToText(page.body);
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
          ? htmlToText(announcement.message)
          : announcement.title,
      },
    });

    sourcesAdded += 1;
  }

  return {
    coursesScanned: courses.length,
    sourcesAdded,
    baselinedCourses,
    warnings,
  };
}
