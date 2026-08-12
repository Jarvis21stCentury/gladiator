import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The window of dates this app cares about.
 *
 * Canvas keeps every course a student has ever been enrolled in, and their
 * assignments come with them. In practice that meant 204 assignments, 56 of
 * them due before this school year — some dated 2021 — sitting in the same
 * lists as tonight's homework. No amount of sorting fixes that; the old work
 * simply is not this year's problem.
 *
 * So every list is bounded by the school year. The defaults are Frisco ISD's
 * published 2026-27 calendar (first day 12 August 2026, last day 14 May 2027),
 * and both ends are editable, because a district calendar is a fact about one
 * district and this should not silently do the wrong thing anywhere else.
 */

export const SCHOOL_YEAR_KEYS = {
  start: "SCHOOL_YEAR_START",
  end: "SCHOOL_YEAR_END",
} as const;

/** Frisco ISD 2026-27, from the district's published student calendar. */
const DEFAULT_START = "2026-08-12";
const DEFAULT_END = "2027-05-14";

export interface SchoolYear {
  start: Date;
  end: Date;
  /** False when these are the built-in defaults rather than the student's own. */
  configured: boolean;
}

/** "2026-08-12" → local midnight, so a date is the day the student means. */
function fromISO(value: string, endOfDay = false): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match.map(Number);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function toISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function getSchoolYear(): Promise<SchoolYear> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(SCHOOL_YEAR_KEYS) } },
  });

  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const start =
    fromISO(stored.get(SCHOOL_YEAR_KEYS.start) ?? "") ?? fromISO(DEFAULT_START)!;
  const end =
    fromISO(stored.get(SCHOOL_YEAR_KEYS.end) ?? "", true) ??
    fromISO(DEFAULT_END, true)!;

  return { start, end, configured: stored.size > 0 };
}

export async function saveSchoolYear(start: string, end: string): Promise<void> {
  const write = (key: string, value: string) =>
    prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

  await prisma.$transaction([
    write(SCHOOL_YEAR_KEYS.start, start),
    write(SCHOOL_YEAR_KEYS.end, end),
  ]);
}

/**
 * A Prisma clause bounding assignments to the school year.
 *
 * Returned as an `AND` fragment rather than a `dueAt` key so it can be dropped
 * into a `where` that already constrains `dueAt` — several do — without one
 * silently replacing the other.
 *
 * Undated assignments are excluded by this, and that is intended. Canvas
 * carries a large number of them (111 here) and they are unschedulable by
 * definition: every list, the forecast and the planner all key off a due date.
 * An assignment with no date cannot be late, cannot be planned, and mostly is
 * not work at all.
 */
export function withinSchoolYear(year: SchoolYear) {
  return [{ dueAt: { gte: year.start } }, { dueAt: { lte: year.end } }];
}
