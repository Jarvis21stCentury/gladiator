import "server-only";

import ICAL from "ical.js";

/**
 * Fallback ingestion path. Canvas's private "Calendar Feed" URL needs no auth and
 * exposes due dates only — no grades, no points, no submission status. Everything
 * here is best-effort: the feed is a calendar, not an API, so course identity has
 * to be recovered from event URLs and summary text.
 */

export interface IcalAssignment {
  canvasAssignmentId: number;
  canvasCourseId: number;
  /** Course code scraped from the summary, e.g. "BIO-101". Best available name. */
  courseLabel: string | null;
  title: string;
  dueAt: Date | null;
  url: string | null;
}

export class IcalFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcalFeedError";
  }
}

/**
 * Canvas assignment events carry a URL like
 * `https://school.instructure.com/courses/123/assignments/456`.
 * That URL is the only reliable link back to Canvas IDs.
 */
function extractIds(
  ...candidates: (string | null | undefined)[]
): { courseId: number; assignmentId: number } | null {
  for (const candidate of candidates) {
    if (!candidate) continue;

    const match = candidate.match(
      /\/courses\/(\d+)\/assignments\/(\d+)/,
    );
    if (match) {
      return {
        courseId: Number(match[1]),
        assignmentId: Number(match[2]),
      };
    }
  }

  return null;
}

/**
 * Canvas formats event summaries as "Assignment Title [Course Code]". Split them
 * so the course gets a human-readable label instead of a bare ID.
 */
function splitSummary(summary: string): {
  title: string;
  courseLabel: string | null;
} {
  const match = summary.match(/^(.*)\s+\[([^\]]+)\]\s*$/);

  if (match) {
    return { title: match[1].trim(), courseLabel: match[2].trim() };
  }

  return { title: summary.trim(), courseLabel: null };
}

export function parseIcalFeed(body: string): IcalAssignment[] {
  let component: ICAL.Component;

  try {
    component = new ICAL.Component(ICAL.parse(body));
  } catch (cause) {
    throw new IcalFeedError(
      `Could not parse the Canvas calendar feed as iCalendar: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  const results: IcalAssignment[] = [];
  const seen = new Set<number>();

  for (const vevent of component.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);

    const url = vevent.getFirstPropertyValue("url");
    const description = vevent.getFirstPropertyValue("description");
    const uid = event.uid;

    const ids = extractIds(
      typeof url === "string" ? url : null,
      typeof description === "string" ? description : null,
      uid,
    );

    // Non-assignment events (personal calendar entries, syllabus dates) have no
    // assignment URL. Without Canvas IDs there is nothing stable to upsert on.
    if (!ids || seen.has(ids.assignmentId)) continue;
    seen.add(ids.assignmentId);

    const { title, courseLabel } = splitSummary(event.summary ?? "Untitled");

    results.push({
      canvasAssignmentId: ids.assignmentId,
      canvasCourseId: ids.courseId,
      courseLabel,
      title,
      // ICAL.Time handles the UTC / floating / TZID cases; toJSDate() normalises.
      dueAt: event.startDate ? event.startDate.toJSDate() : null,
      url: typeof url === "string" ? url : null,
    });
  }

  return results;
}

export async function fetchIcalFeed(feedUrl: string): Promise<IcalAssignment[]> {
  const response = await fetch(feedUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new IcalFeedError(
      `Calendar feed returned HTTP ${response.status}. Check CANVAS_ICAL_URL — the feed URL is private and is regenerated if the user resets it.`,
    );
  }

  return parseIcalFeed(await response.text());
}
