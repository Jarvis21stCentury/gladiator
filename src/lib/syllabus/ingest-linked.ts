import "server-only";

import { CanvasClient } from "@/lib/canvas/client";
import { getCanvasConfig, hasApiCredentials } from "@/lib/canvas/config";
import { prisma } from "@/lib/prisma";

import {
  fetchGoogleFileText,
  findGoogleLinksWithText,
  looksLikeSchedule,
  GoogleDocError,
  type GoogleFileRef,
} from "./google-docs";
import { parseSyllabusText } from "./parse";

/**
 * Finding each class's assessment plan and reading the test dates out of it.
 *
 * The gap this closes: a unit test that is not a Canvas assignment has no due
 * date anywhere in this app. It is printed on a Google Doc the teacher linked
 * from Canvas — "Assessment Plan", "Unit Calendar", the syllabus — and until
 * now nothing read those, so the planner would happily fill the night before a
 * test with unrelated homework.
 *
 * ## Where it looks, in order of how likely the link is to be a schedule
 *
 *   1. The course's Canvas **Syllabus** tab. Whatever is linked there is the
 *      course's own account of itself.
 *   2. **Pages**, schedule-titled ones first ("Syllabus", "Assessment Plan",
 *      "Unit 3 Calendar"), then the rest up to a cap.
 *   3. **Module items** of type ExternalUrl pointing at Google.
 *
 * A link is followed when *either* the page it sits on or the words linked look
 * like a schedule. Gating on the page title alone missed the common case
 * outright — a teacher's Home page linking "Assessment Plan". Teachers link a lot of Google files that are not calendars — note
 * templates, lab forms, seating charts — and parsing all of them would spend a
 * model call each and invite the extractor to invent dates in a document that
 * has none.
 *
 * Everything found goes through `parseSyllabusText`, the same path an uploaded
 * PDF takes: same prompt, same Canvas-wins write rules, same SyllabusImport
 * record. A second extractor that was meant to agree with the first eventually
 * would not.
 */

export interface LinkedDocResult {
  courseName: string;
  label: string;
  status: "parsed" | "restricted" | "failed" | "skipped";
  datesWritten?: number;
  categoriesWritten?: number;
  error?: string;
}

export interface IngestLinkedResult {
  coursesScanned: number;
  documentsFound: number;
  documentsParsed: number;
  /**
   * Google links seen before the schedule filter.
   *
   * Reported so "no assessment plan found" is explainable. Zero documents out
   * of zero links means nothing is linked; zero out of twelve means the filter
   * rejected them all, and those are completely different problems.
   */
  googleLinksSeen: number;
  pagesScanned: number;
  datesWritten: number;
  results: LinkedDocResult[];
  warnings: string[];
}

/**
 * Page bodies fetched per course.
 *
 * One request each, and a course can have dozens. Schedule-titled pages are
 * ordered first so the cap never costs the page most likely to hold the plan.
 */
const MAX_PAGES_PER_COURSE = 12;

/** One Google file, with the words that introduced it. */
interface Candidate {
  file: GoogleFileRef;
  label: string;
}

/**
 * Files already read for this course, by id.
 *
 * A teacher edits the assessment plan; the id does not change. Re-reading it is
 * how a moved test date ever reaches the student, so this is deliberately *not*
 * a permanent skip list — it is only consulted when `force` is off, which is
 * what keeps an unattended nightly run from spending eight model calls to
 * re-learn the same dates.
 */
async function alreadyRead(courseId: string): Promise<Set<string>> {
  const imports = await prisma.syllabusImport.findMany({
    where: { courseId, fileName: { startsWith: "google:" } },
    select: { fileName: true },
  });

  return new Set(imports.map((row) => row.fileName));
}

export async function ingestLinkedSchedules({
  force = false,
}: { force?: boolean } = {}): Promise<IngestLinkedResult> {
  const config = await getCanvasConfig();
  const warnings: string[] = [];

  if (!hasApiCredentials(config)) {
    return {
      coursesScanned: 0,
      documentsFound: 0,
      documentsParsed: 0,
      googleLinksSeen: 0,
      pagesScanned: 0,
      datesWritten: 0,
      results: [],
      warnings: ["Canvas API not configured; there are no linked pages to scan."],
    };
  }

  const client = new CanvasClient({
    baseUrl: config.baseUrl!,
    token: config.token!,
  });

  const courses = (
    await prisma.course.findMany({
      where: { canvasId: { not: null }, hidden: false },
      select: { id: true, canvasId: true, name: true },
    })
  ).filter(
    (course): course is { id: string; canvasId: number; name: string } =>
      course.canvasId !== null,
  );

  const results: LinkedDocResult[] = [];
  let documentsFound = 0;
  let documentsParsed = 0;
  let googleLinksSeen = 0;
  let pagesScanned = 0;
  let datesWritten = 0;

  for (const course of courses) {
    try {
      const candidates = new Map<string, Candidate>();

      /*
       * A link is followed when *either* the thing it sits on or the words
       * linked look like a schedule. Gating on the page title alone missed the
       * common case outright — a teacher's Home page linking "Assessment Plan"
       * — and gating on nothing would spend a model call on every seating
       * chart and note template in the course.
       */
      const consider = (html: string, source: string) => {
        if (!html) return;

        for (const { file, text } of findGoogleLinksWithText(html)) {
          googleLinksSeen += 1;

          const label = text || source;
          if (!looksLikeSchedule(source) && !looksLikeSchedule(text)) continue;
          if (!candidates.has(file.id)) candidates.set(file.id, { file, label });
        }
      };

      // 1. The Syllabus tab. Always worth reading — whatever a course links
      //    from its own syllabus is its own account of itself.
      const syllabusBody = await client.getSyllabusBody(course.canvasId);
      if (syllabusBody) consider(syllabusBody, "syllabus");

      // 2. Pages. Schedule-titled ones always; the rest are still scanned
      //    because the link text can carry the signal the title doesn't.
      const pages = await client.getAllPageRefs(course.canvasId);
      const ordered = [
        ...pages.filter((page) => looksLikeSchedule(page.title)),
        ...pages.filter((page) => !looksLikeSchedule(page.title)),
      ].slice(0, MAX_PAGES_PER_COURSE);

      for (const page of ordered) {
        const full = await client.getPage(course.canvasId, page.url);
        if (!full?.body) continue;

        pagesScanned += 1;
        consider(full.body, page.title);
      }

      // 3. External links in modules.
      for (const canvasModule of await client.getModules(course.canvasId)) {
        for (const item of canvasModule.items ?? []) {
          if (item.type !== "ExternalUrl" || !item.html_url) continue;
          consider(item.html_url, item.title);
        }
      }

      const seen = force ? new Set<string>() : await alreadyRead(course.id);

      for (const { file, label } of candidates.values()) {
        documentsFound += 1;

        const fileName = `google:${file.id}`;
        if (seen.has(fileName)) {
          results.push({ courseName: course.name, label, status: "skipped" });
          continue;
        }

        try {
          const text = await fetchGoogleFileText(file);

          const parsed = await parseSyllabusText({
            courseId: course.id,
            // Prefixed so a re-run can recognise it, and so the Classes page's
            // "last parsed" line names the document rather than a raw id.
            fileName,
            text: `${label}\n\n${text}`,
          });

          documentsParsed += 1;
          datesWritten += parsed.datesWritten;

          results.push({
            courseName: course.name,
            label,
            status: "parsed",
            datesWritten: parsed.datesWritten,
            categoriesWritten: parsed.categoriesWritten,
          });
        } catch (error) {
          const restricted =
            error instanceof GoogleDocError && error.kind === "restricted";

          results.push({
            courseName: course.name,
            label,
            status: restricted ? "restricted" : "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      warnings.push(
        `Scanning "${course.name}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    coursesScanned: courses.length,
    documentsFound,
    documentsParsed,
    googleLinksSeen,
    pagesScanned,
    datesWritten,
    results,
    warnings,
  };
}
