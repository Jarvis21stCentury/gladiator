import "server-only";

import { getCourseTrends } from "@/lib/analytics/trend";
import { prisma } from "@/lib/prisma";
import { getSchoolYear, withinSchoolYear } from "@/lib/school-year";
import { getWorkloadForecast } from "@/lib/workload/forecast";
import type { StruggleType } from "@/generated/prisma/enums";

/**
 * The struggles engine (FEATURES.md Tier 2).
 *
 * Detection is entirely deterministic. Every rule below is arithmetic over data
 * already in the database, which matters for two reasons: the front page's verdict
 * reads the result and must work with no API key configured, and a flag that
 * says "you have missed 3 of the last 5 Chemistry assignments" is only
 * trustworthy if a model never had the chance to invent the 3.
 *
 * The model's job is downstream and optional — see `explain.ts`, which rewrites
 * `description` into something worth reading. A rules-written sentence is
 * always produced first so the feature degrades to plain instead of to nothing.
 */

/** How far back "recently" reaches when counting missed work. */
const MISS_WINDOW_DAYS = 14;
/** Longer window for spotting a class that has gone quiet entirely. */
const SILENCE_WINDOW_DAYS = 21;
const SILENCE_MIN_ASSIGNMENTS = 3;
/** Only spikes inside this many days are worth flagging now. */
const SPIKE_HORIZON_DAYS = 7;

export interface DetectedStruggle {
  signature: string;
  type: StruggleType;
  courseId: string | null;
  severity: number;
  title: string;
  /** The deterministic sentence. `explain.ts` may replace it. */
  description: string;
  evidence: string[];
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// --- Rules ---------------------------------------------------------------

/**
 * A cluster of missed work in one class. One missed assignment is a bad week;
 * two in a fortnight is a pattern, which is the distinction FEATURES.md asks
 * for ("real patterns", not a red dot on every late item).
 */
async function detectMissedClusters(): Promise<DetectedStruggle[]> {
  const year = await getSchoolYear();

  const missed = await prisma.assignment.findMany({
    where: {
      submitted: false,
      dueAt: { gte: daysAgo(MISS_WINDOW_DAYS), lt: new Date() },
      course: { hidden: false },
      AND: withinSchoolYear(year),
    },
    orderBy: { dueAt: "desc" },
    include: { course: { select: { id: true, name: true } } },
  });

  const byCourse = new Map<string, typeof missed>();
  for (const assignment of missed) {
    const bucket = byCourse.get(assignment.courseId) ?? [];
    bucket.push(assignment);
    byCourse.set(assignment.courseId, bucket);
  }

  const flags: DetectedStruggle[] = [];

  for (const [courseId, items] of byCourse) {
    if (items.length < 2) continue;

    const courseName = items[0].course.name;
    const lostPoints = items.reduce(
      (sum, item) => sum + (item.pointsPossible ?? 0),
      0,
    );

    flags.push({
      signature: `MISSED_CLUSTER:${courseId}`,
      type: "MISSED_CLUSTER",
      courseId,
      severity: items.length >= 3 ? 3 : 2,
      title: `${courseName} — ${plural(items.length, "assignment")} missed`,
      description: `${plural(items.length, "assignment")} in ${courseName} passed their due date unsubmitted in the last ${MISS_WINDOW_DAYS} days, worth ${Math.round(lostPoints)} points.`,
      evidence: items.map(
        (item) =>
          `"${item.title}" was due ${item.dueAt?.toLocaleDateString()} and is unsubmitted${item.pointsPossible ? ` (${item.pointsPossible} pts)` : ""}`,
      ),
    });
  }

  return flags;
}

/** A grade moving down on consecutive checks — the Tier 2 slide rule. */
async function detectGradeSlides(): Promise<DetectedStruggle[]> {
  const trends = await getCourseTrends();

  return trends
    .filter((trend) => trend.consecutiveDrops >= 2)
    .map((trend) => {
      const latest = trend.points[trend.points.length - 1];
      const start = trend.points[trend.points.length - 1 - trend.consecutiveDrops];
      const lost = start ? start.gradePercent - latest.gradePercent : 0;

      return {
        signature: `GRADE_SLIDE:${trend.courseId}`,
        type: "GRADE_SLIDE" as StruggleType,
        courseId: trend.courseId,
        // A slide that has already taken the grade below a C is the more
        // urgent version of the same pattern.
        severity: latest.gradePercent < 75 || lost >= 5 ? 3 : 2,
        title: `${trend.courseName} — grade sliding`,
        description: `${trend.courseName} has dropped on ${trend.consecutiveDrops} checks in a row, from ${start?.gradePercent.toFixed(1)}% to ${latest.gradePercent.toFixed(1)}%.`,
        evidence: trend.points
          .slice(-(trend.consecutiveDrops + 1))
          .map(
            (point) =>
              `${point.date.toLocaleDateString()}: ${point.gradePercent.toFixed(1)}%`,
          ),
      };
    });
}

/**
 * A class that has stopped receiving submissions entirely, while others have
 * not. Scoped against the other classes on purpose — during a week when nothing
 * was submitted anywhere, that is a schedule problem, not a problem with one
 * subject, and flagging five classes at once would be noise.
 */
async function detectSubmissionSilence(): Promise<DetectedStruggle[]> {
  const since = daysAgo(SILENCE_WINDOW_DAYS);

  const year = await getSchoolYear();

  const courses = await prisma.course.findMany({
    where: { hidden: false },
    select: {
      id: true,
      name: true,
      assignments: {
        where: {
          dueAt: { gte: since, lt: new Date() },
          AND: withinSchoolYear(year),
        },
        select: { id: true, title: true, submitted: true, dueAt: true },
      },
    },
  });

  const withWork = courses.filter(
    (course) => course.assignments.length >= SILENCE_MIN_ASSIGNMENTS,
  );

  const rateOf = (course: (typeof withWork)[number]): number =>
    course.assignments.filter((assignment) => assignment.submitted).length /
    course.assignments.length;

  // Is anything being handed in anywhere? If not, this rule stays quiet.
  const somewhereHealthy = withWork.some((course) => rateOf(course) >= 0.5);
  if (!somewhereHealthy) return [];

  return withWork
    .filter((course) => rateOf(course) === 0)
    .map((course) => ({
      signature: `SUBMISSION_SILENCE:${course.id}`,
      type: "SUBMISSION_SILENCE" as StruggleType,
      courseId: course.id,
      severity: 3,
      title: `${course.name} — nothing submitted in ${SILENCE_WINDOW_DAYS} days`,
      description: `Every one of the ${course.assignments.length} ${course.name} assignments due in the last ${SILENCE_WINDOW_DAYS} days is unsubmitted, while other classes are being handed in normally.`,
      evidence: course.assignments.map(
        (assignment) =>
          `"${assignment.title}" (due ${assignment.dueAt?.toLocaleDateString()}) — not submitted`,
      ),
    }));
}

/** A day in the near forecast with more work than hours. */
async function detectWorkloadSpikes(): Promise<DetectedStruggle[]> {
  const forecast = await getWorkloadForecast();

  return forecast.days
    .filter((day) => day.offset <= SPIKE_HORIZON_DAYS && day.loadRatio >= 1.25)
    .map((day) => {
      const label = day.date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });

      return {
        // Dated, so tomorrow's spike is a different condition from Friday's and
        // resolving one doesn't silence the other.
        signature: `WORKLOAD_SPIKE:${day.date.toISOString().slice(0, 10)}`,
        type: "WORKLOAD_SPIKE" as StruggleType,
        courseId: null,
        severity: day.loadRatio >= 1.75 ? 3 : 2,
        title: `${label} is overloaded`,
        description: `${label} has about ${Math.round(day.loadMinutes / 60)} hours of work due against roughly ${Math.round(day.capacityMinutes / 60)} hours of study time. Some of it needs starting earlier.`,
        evidence: day.items.map(
          (item) =>
            `"${item.title}" (${item.courseName}) — ${item.estimatedMinutes} min`,
        ),
      };
    });
}

/** Overdue work accumulating across every class rather than being cleared. */
async function detectOverduePileup(): Promise<DetectedStruggle[]> {
  const year = await getSchoolYear();

  /*
   * Only this year's work counts as a pileup.
   *
   * Canvas keeps every assignment a student has ever had, so without the
   * bound this flagged 55 "overdue" items — most of them from 2021 — and
   * raised a permanent, unclearable warning about work that stopped mattering
   * years ago.
   */
  const overdue = await prisma.assignment.findMany({
    where: {
      submitted: false,
      dueAt: { lt: new Date() },
      course: { hidden: false },
      AND: withinSchoolYear(year),
    },
    orderBy: { dueAt: "asc" },
    include: { course: { select: { name: true } } },
  });

  if (overdue.length < 3) return [];

  const courseCount = new Set(overdue.map((item) => item.course.name)).size;

  return [
    {
      signature: "OVERDUE_PILEUP:all",
      type: "OVERDUE_PILEUP",
      courseId: null,
      severity: overdue.length >= 6 ? 3 : 2,
      title: `${plural(overdue.length, "item")} overdue`,
      description: `${plural(overdue.length, "assignment")} across ${plural(courseCount, "class", "classes")} are past due and unsubmitted. The oldest has been open since ${overdue[0].dueAt?.toLocaleDateString()}.`,
      evidence: overdue
        .slice(0, 8)
        .map(
          (item) =>
            `"${item.title}" (${item.course.name}) — due ${item.dueAt?.toLocaleDateString()}`,
        ),
    },
  ];
}

/** Run every rule. Exported so the API can preview without persisting. */
export async function detectStruggles(): Promise<DetectedStruggle[]> {
  const groups = await Promise.all([
    detectMissedClusters(),
    detectGradeSlides(),
    detectSubmissionSilence(),
    detectWorkloadSpikes(),
    detectOverduePileup(),
  ]);

  return groups
    .flat()
    .sort((a, b) => b.severity - a.severity || a.title.localeCompare(b.title));
}
