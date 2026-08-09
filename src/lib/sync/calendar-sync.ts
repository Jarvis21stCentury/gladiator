import "server-only";

import {
  ASSIGNMENT_ID_KEY,
  GoogleCalendarClient,
  MANAGED_BY_KEY,
  MANAGED_BY_VALUE,
  eventEnd,
  eventStart,
  isManagedByApp,
  type GoogleEvent,
  type GoogleEventInput,
} from "@/lib/google/calendar";
import { getGoogleConfig, isCalendarConfigured } from "@/lib/google/config";
import { prisma } from "@/lib/prisma";
import { CalendarBlockType, SyncMode, SyncStatus } from "@/generated/prisma/enums";

/** How long the due-date block occupies, ending at the deadline. */
const BLOCK_MINUTES = 30;

export interface CalendarSyncResult {
  status: SyncStatus;
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  warnings: string[];
  error: string | null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return a === b;
  return a.getTime() === b.getTime();
}

type AssignmentWithCourse = {
  id: string;
  /** Null on syllabus-derived rows — those have no Canvas page to link to. */
  canvasId: number | null;
  title: string;
  dueAt: Date | null;
  pointsPossible: number | null;
  course: { name: string; canvasId: number };
};

function buildEvent(assignment: AssignmentWithCourse, dueAt: Date) {
  const start = new Date(dueAt.getTime() - BLOCK_MINUTES * 60_000);
  const canvasBase = process.env.CANVAS_BASE_URL?.trim().replace(/\/+$/, "");

  const lines = [`${assignment.course.name} — due ${dueAt.toLocaleString()}`];
  if (assignment.pointsPossible !== null) {
    lines.push(`${assignment.pointsPossible} points`);
  }
  if (canvasBase) {
    lines.push(
      `${canvasBase}/courses/${assignment.course.canvasId}/assignments/${assignment.canvasId}`,
    );
  }
  lines.push("", "Created by Gladiator. Move or edit it and it will be left alone.");

  const input: GoogleEventInput = {
    summary: `${assignment.title} — ${assignment.course.name}`,
    description: lines.join("\n"),
    start,
    end: dueAt,
    privateProperties: {
      [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
      [ASSIGNMENT_ID_KEY]: assignment.id,
    },
  };

  return { input, start, end: dueAt };
}

/**
 * Has the user touched this event since we last wrote it? `block.start`/`end`/
 * `title` are our last-written values, so any divergence is the user's doing.
 */
function hasUserEdits(
  event: GoogleEvent,
  block: { start: Date; end: Date; title: string },
): boolean {
  if (!sameInstant(eventStart(event), block.start)) return true;
  if (!sameInstant(eventEnd(event), block.end)) return true;
  if ((event.summary ?? "") !== block.title) return true;
  return false;
}

/**
 * Push Canvas due dates into Google Calendar.
 *
 * The safety rule runs through every branch here: this only ever writes to events
 * it created (proved by the private marker *and* a stored googleEventId), and the
 * moment one of those events differs from what we last wrote, it is abandoned for
 * good rather than corrected.
 */
export async function runCalendarSync(): Promise<CalendarSyncResult> {
  const config = await getGoogleConfig();
  const warnings: string[] = [];

  if (!isCalendarConfigured(config)) {
    throw new Error(
      "Google Calendar is not connected. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN — visit /api/google/auth to mint a refresh token.",
    );
  }

  const run = await prisma.syncRun.create({
    data: { mode: SyncMode.GOOGLE_CALENDAR, status: SyncStatus.RUNNING },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let deleted = 0;

  try {
    const client = new GoogleCalendarClient(config);

    // One list call instead of one GET per assignment.
    const managed = await client.listManagedEvents();

    const assignments = await prisma.assignment.findMany({
      include: { course: { select: { name: true, canvasId: true } } },
    });

    const blocks = await prisma.calendarBlock.findMany({
      where: { linkedAssignmentId: { not: null } },
    });
    const blockByAssignment = new Map(
      blocks.map((block) => [block.linkedAssignmentId!, block]),
    );

    for (const assignment of assignments) {
      const block = blockByAssignment.get(assignment.id);

      // Due date removed in Canvas: clean up the event we made, unless the user
      // has since taken ownership of it.
      if (!assignment.dueAt) {
        if (block?.googleEventId && !block.userModified && !block.deletedInGoogle) {
          await client.deleteEvent(block.googleEventId);
          await prisma.calendarBlock.delete({ where: { id: block.id } });
          deleted += 1;
        } else if (block) {
          skipped += 1;
        }
        continue;
      }

      const { input, start, end } = buildEvent(assignment, assignment.dueAt);

      // Never re-enter an event the user has taken over or deleted.
      if (block?.userModified || block?.deletedInGoogle) {
        skipped += 1;
        continue;
      }

      if (!block || !block.googleEventId) {
        const event = await client.createEvent(input);

        const data = {
          title: input.summary,
          start,
          end,
          type: CalendarBlockType.ASSIGNMENT,
          googleEventId: event.id,
          googleCalendarId: client.calendarId,
          linkedAssignmentId: assignment.id,
          lastPushedAt: new Date(),
        };

        if (block) {
          await prisma.calendarBlock.update({ where: { id: block.id }, data });
        } else {
          await prisma.calendarBlock.create({ data });
        }

        created += 1;
        continue;
      }

      let event = managed.get(block.googleEventId) ?? null;

      // Not in the managed list. Could be deleted, or just outside what the list
      // returned — confirm with a direct read before drawing a permanent
      // conclusion, since "deleted" means we never recreate it.
      if (!event) {
        event = await client.getEvent(block.googleEventId);

        if (!event) {
          await prisma.calendarBlock.update({
            where: { id: block.id },
            data: { deletedInGoogle: true },
          });
          skipped += 1;
          continue;
        }
      }

      // The marker is gone, or this ID now points at something we didn't make.
      if (!isManagedByApp(event)) {
        await prisma.calendarBlock.update({
          where: { id: block.id },
          data: { userModified: true },
        });
        skipped += 1;
        continue;
      }

      if (hasUserEdits(event, block)) {
        await prisma.calendarBlock.update({
          where: { id: block.id },
          data: { userModified: true },
        });
        skipped += 1;
        continue;
      }

      // Untouched by the user — is there anything new from Canvas to push?
      const unchanged =
        sameInstant(block.start, start) &&
        sameInstant(block.end, end) &&
        block.title === input.summary;

      if (unchanged) continue;

      const result = await client.updateEvent(block.googleEventId, input);

      if (!result) {
        await prisma.calendarBlock.update({
          where: { id: block.id },
          data: { deletedInGoogle: true },
        });
        skipped += 1;
        continue;
      }

      await prisma.calendarBlock.update({
        where: { id: block.id },
        data: {
          title: input.summary,
          start,
          end,
          googleCalendarId: client.calendarId,
          lastPushedAt: new Date(),
        },
      });

      updated += 1;
    }

    if (skipped > 0) {
      warnings.push(
        `${skipped} event(s) left untouched because they were moved, edited or deleted by hand.`,
      );
    }

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncStatus.SUCCESS,
        finishedAt: new Date(),
        eventsCreated: created,
        eventsUpdated: updated,
        eventsSkipped: skipped,
        error: warnings.length > 0 ? warnings.join(" | ") : null,
      },
    });

    return {
      status: SyncStatus.SUCCESS,
      created,
      updated,
      skipped,
      deleted,
      warnings,
      error: null,
    };
  } catch (error) {
    const message = describe(error);

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        eventsCreated: created,
        eventsUpdated: updated,
        eventsSkipped: skipped,
        error: message,
      },
    });

    return {
      status: SyncStatus.FAILED,
      created,
      updated,
      skipped,
      deleted,
      warnings,
      error: message,
    };
  }
}
