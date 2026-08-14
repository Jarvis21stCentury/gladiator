import "server-only";

import { CanvasAuthError, CanvasClient } from "@/lib/canvas/client";
import { getCanvasConfig, hasApiCredentials } from "@/lib/canvas/config";
import { fetchIcalFeed, type IcalAssignment } from "@/lib/canvas/ical";
import { prisma } from "@/lib/prisma";
import { SyncMode, SyncStatus } from "@/generated/prisma/enums";

export interface SyncResult {
  mode: SyncMode;
  status: SyncStatus;
  coursesSynced: number;
  assignmentsSynced: number;
  announcementsSynced: number;
  /** Non-fatal problems — one course failing shouldn't lose the other five. */
  warnings: string[];
  error: string | null;
}

/** Midnight UTC for today, matching `GradeSnapshot.date` (`@db.Date`). */
function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Full sync over the REST API: courses + current grade, assignments with
 * submission state, and announcements.
 */
async function syncViaApi(
  client: CanvasClient,
  warnings: string[],
): Promise<Omit<SyncResult, "mode" | "status" | "error">> {
  const courses = await client.getCourses();

  let assignmentsSynced = 0;
  let announcementsSynced = 0;
  const courseIdByCanvasId = new Map<number, string>();

  for (const course of courses) {
    // The student enrollment is the one carrying computed_current_score.
    const enrollment = course.enrollments?.find(
      (item) => item.type === "student" || item.role === "StudentEnrollment",
    );
    const gradePercent = enrollment?.computed_current_score ?? null;

    /*
     * Canvas may only post a grade where nothing better already exists.
     *
     * Three systems write this one field and they rank: what the student typed
     * outranks the district gradebook, which outranks Canvas. HAC's average is
     * the one on the report card — Canvas shows whatever that particular teacher
     * keeps in Canvas, which is routinely partial and sometimes an entirely
     * different number for the same class. Letting a sync order decide which
     * grade the student sees meant the answer changed depending on which button
     * was pressed last.
     */
    const existing = await prisma.course.findUnique({
      where: { canvasId: course.id },
      select: { gradeSource: true },
    });

    /*
     * Canvas does not post a grade for a class HAC knows about.
     *
     * HAC is the district gradebook: its average is the one on the report card,
     * and it is the number the student is actually graded on. Canvas shows
     * whatever that teacher happens to keep in Canvas, which is often a
     * fragment — AP Seminar read 60% here off a single quiz while HAC had
     * posted nothing at all. A number that low, presented as "your grade", is
     * worse than no number.
     *
     * So Canvas fills the gap only for classes HAC has never heard of. For
     * everything else the choice is HAC's average or an honest blank, and the
     * page already says "HAC hasn't posted an average yet" for the blank.
     */
    const knownToHac =
      (await prisma.assignment.count({
        where: { course: { canvasId: course.id }, source: "HAC" },
      })) > 0;

    const mayWriteGrade =
      gradePercent !== null &&
      !knownToHac &&
      (existing?.gradeSource === null ||
        existing?.gradeSource === undefined ||
        existing.gradeSource === "CANVAS");

    const record = await prisma.course.upsert({
      where: { canvasId: course.id },
      create: {
        canvasId: course.id,
        name: course.name,
        term: course.term?.name ?? null,
        currentGradePercent: gradePercent,
        gradeSource: gradePercent === null ? null : "CANVAS",
      },
      update: {
        name: course.name,
        term: course.term?.name ?? null,
        /*
         * Only write the grade when Canvas actually has one.
         *
         * `computed_current_score` is null for plenty of real classes — nothing
         * graded yet, or a teacher who keeps grades elsewhere. Writing that null
         * through would erase a grade the student typed in by hand, silently,
         * on the next sync. Canvas wins when Canvas knows; it does not get to
         * overwrite with an absence.
         */
        ...(mayWriteGrade
          ? { currentGradePercent: gradePercent, gradeSource: "CANVAS" as const }
          : {}),
      },
    });

    courseIdByCanvasId.set(course.id, record.id);

    // One snapshot per course per day. Re-syncing the same day overwrites rather
    // than appending, so trend data stays one point per day. Gated on the same
    // ranking as the grade itself: a trend built from two systems' numbers is a
    // sawtooth that means nothing.
    if (mayWriteGrade) {
      const date = todayUtc();
      await prisma.gradeSnapshot.upsert({
        where: { courseId_date: { courseId: record.id, date } },
        create: { courseId: record.id, date, gradePercent },
        update: { gradePercent },
      });
    }

    try {
      const assignments = await client.getAssignments(course.id);

      for (const assignment of assignments) {
        const submission = assignment.submission ?? null;
        const fields = {
          courseId: record.id,
          title: assignment.name,
          dueAt: assignment.due_at ? new Date(assignment.due_at) : null,
          pointsPossible: assignment.points_possible ?? null,
          submitted: Boolean(submission?.submitted_at),
          score: submission?.score ?? null,
        };

        await prisma.assignment.upsert({
          where: { canvasId: assignment.id },
          create: { canvasId: assignment.id, ...fields },
          update: fields,
        });
      }

      assignmentsSynced += assignments.length;
    } catch (error) {
      // A single course with restricted assignments shouldn't fail the run.
      if (error instanceof CanvasAuthError) throw error;
      warnings.push(
        `Assignments for "${course.name}" failed: ${describe(error)}`,
      );
    }
  }

  try {
    const announcements = await client.getAnnouncements(
      courses.map((course) => course.id),
    );

    for (const announcement of announcements) {
      const canvasCourseId = Number(
        announcement.context_code?.replace("course_", ""),
      );
      const courseId = courseIdByCanvasId.get(canvasCourseId);

      // Announcements from a context we didn't sync have no course to hang off.
      if (!courseId) continue;

      const fields = {
        courseId,
        title: announcement.title,
        message: announcement.message,
        postedAt: announcement.posted_at
          ? new Date(announcement.posted_at)
          : null,
        url: announcement.html_url,
      };

      await prisma.announcement.upsert({
        where: { canvasId: announcement.id },
        create: { canvasId: announcement.id, ...fields },
        update: fields,
      });

      announcementsSynced += 1;
    }
  } catch (error) {
    if (error instanceof CanvasAuthError) throw error;
    warnings.push(`Announcements failed: ${describe(error)}`);
  }

  return {
    coursesSynced: courses.length,
    assignmentsSynced,
    announcementsSynced,
    warnings,
  };
}

/**
 * Degraded path: due dates only. Writes strictly the fields the feed knows about
 * so it never clobbers richer data left behind by an earlier API sync.
 */
async function syncViaIcal(
  feedUrl: string,
  warnings: string[],
): Promise<Omit<SyncResult, "mode" | "status" | "error">> {
  const events = await fetchIcalFeed(feedUrl);

  const byCourse = new Map<number, IcalAssignment[]>();
  for (const event of events) {
    const bucket = byCourse.get(event.canvasCourseId) ?? [];
    bucket.push(event);
    byCourse.set(event.canvasCourseId, bucket);
  }

  let assignmentsSynced = 0;

  for (const [canvasCourseId, items] of byCourse) {
    const label =
      items.find((item) => item.courseLabel)?.courseLabel ??
      `Canvas course ${canvasCourseId}`;

    // `update: {}` on purpose — the feed's scraped label is worse than a real
    // course name, and it carries no grade. Never overwrite API-sourced data.
    const record = await prisma.course.upsert({
      where: { canvasId: canvasCourseId },
      create: { canvasId: canvasCourseId, name: label },
      update: {},
    });

    for (const item of items) {
      await prisma.assignment.upsert({
        where: { canvasId: item.canvasAssignmentId },
        create: {
          canvasId: item.canvasAssignmentId,
          courseId: record.id,
          title: item.title,
          dueAt: item.dueAt,
        },
        update: {
          title: item.title,
          dueAt: item.dueAt,
        },
      });

      assignmentsSynced += 1;
    }
  }

  warnings.push(
    "Ran on the iCal calendar feed: due dates only. Grades, points and submission status were not updated.",
  );

  return {
    coursesSynced: byCourse.size,
    assignmentsSynced,
    announcementsSynced: 0,
    warnings,
  };
}

/**
 * Entry point for the manual sync trigger. Prefers the REST API and falls back to
 * the iCal feed when the token is missing or rejected — the fallback is recorded
 * on the SyncRun so the dashboard can say so out loud.
 */
export async function runCanvasSync(): Promise<SyncResult> {
  const config = await getCanvasConfig();
  const warnings: string[] = [];

  if (!hasApiCredentials(config) && !config.icalUrl) {
    throw new Error(
      "No Canvas credentials configured. Set CANVAS_BASE_URL + CANVAS_TOKEN, or CANVAS_ICAL_URL for the fallback. See .env.example.",
    );
  }

  let mode: SyncMode = hasApiCredentials(config)
    ? SyncMode.CANVAS_API
    : SyncMode.ICAL_FALLBACK;

  const run = await prisma.syncRun.create({
    data: { mode, status: SyncStatus.RUNNING },
  });

  try {
    let totals: Omit<SyncResult, "mode" | "status" | "error">;

    if (mode === SyncMode.CANVAS_API) {
      const client = new CanvasClient({
        baseUrl: config.baseUrl!,
        token: config.token!,
      });

      try {
        await client.verifyToken();
        totals = await syncViaApi(client, warnings);
      } catch (error) {
        // The case ARCHITECTURE.md calls out: token access restricted. Drop to
        // the feed rather than failing the sync outright.
        if (!(error instanceof CanvasAuthError) || !config.icalUrl) throw error;

        warnings.push(`Canvas API unavailable: ${describe(error)}`);
        mode = SyncMode.ICAL_FALLBACK;
        totals = await syncViaIcal(config.icalUrl, warnings);
      }
    } else {
      warnings.push(
        "CANVAS_TOKEN is not set, so the calendar feed was used instead.",
      );
      totals = await syncViaIcal(config.icalUrl!, warnings);
    }

    const status =
      totals.warnings.length > 0 ? SyncStatus.PARTIAL : SyncStatus.SUCCESS;

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        mode,
        status,
        finishedAt: new Date(),
        coursesSynced: totals.coursesSynced,
        assignmentsSynced: totals.assignmentsSynced,
        announcementsSynced: totals.announcementsSynced,
        error: totals.warnings.length > 0 ? totals.warnings.join(" | ") : null,
      },
    });

    return { mode, status, ...totals, error: null };
  } catch (error) {
    const message = describe(error);

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        mode,
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        error: message,
      },
    });

    return {
      mode,
      status: SyncStatus.FAILED,
      coursesSynced: 0,
      assignmentsSynced: 0,
      announcementsSynced: 0,
      warnings,
      error: message,
    };
  }
}
