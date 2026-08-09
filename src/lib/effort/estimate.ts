import "server-only";

import { prisma } from "@/lib/prisma";

import { difficultyFactor } from "./difficulty";

/**
 * Effort estimation and the calibration engine (FEATURES.md Tier 2).
 *
 * This used to live inside the daily planner. The workload forecast needs the
 * same numbers — a heat map built on a different estimate than the plan would
 * contradict the plan on screen — so it moved here and both read it.
 *
 * The calibration idea is the point: a generic "an essay takes 75 minutes"
 * average is worth very little, but *this* student's logged actual-vs-estimated
 * ratio is worth a lot. Every logged item makes the next estimate better.
 */

/** Clamp for any estimate. Nothing plans as a 4-hour unbroken block. */
const MIN_MINUTES = 10;
const MAX_MINUTES = 240;

/** Below this many logs, the personal bias factor isn't trustworthy yet. */
const MIN_LOGS_FOR_BIAS = 3;

/** How far the bias factor is allowed to move an estimate. */
const MIN_BIAS = 0.5;
const MAX_BIAS = 2.5;

export { DIFFICULTY_LABEL, difficultyFactor } from "./difficulty";

export type EffortSource =
  | "logged-assignment"
  | "logged-course"
  | "calibrated"
  /** Adjusted by the student's own difficulty rating. */
  | "rated"
  | "default";

export interface EffortEstimate {
  minutes: number;
  source: EffortSource;
}

export interface AssignmentLike {
  id: string;
  title: string;
  courseId: string;
  pointsPossible: number | null;
  /** The student's own 1–5 rating, or null if they never gave one. */
  difficulty?: number | null;
}


/**
 * Fallback estimate for an assignment with no logged history. Points are the
 * only real signal Canvas gives us, so scale off those and nudge by the kind of
 * work the title implies.
 */
export function defaultEstimate(title: string, points: number | null): number {
  const text = title.toLowerCase();

  let base: number;
  if (/\b(exam|midterm|final|test)\b/.test(text)) base = 90;
  else if (/\b(essay|paper|project|lab report|research)\b/.test(text)) base = 75;
  else if (/\b(lab|presentation|discussion)\b/.test(text)) base = 45;
  else if (/\b(quiz|reading|worksheet|check|warm.?up)\b/.test(text)) base = 25;
  else base = 40;

  // A 100-point assignment is meaningfully bigger than a 5-point one; damp the
  // scaling so a huge point value can't produce an absurd estimate.
  if (points !== null && points > 0) {
    const scale = Math.min(2, Math.max(0.5, points / 50));
    base = Math.round(base * scale);
  }

  return clamp(base);
}

function clamp(minutes: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface CalibrationSummary {
  /** Logs that recorded an estimate as well as an actual — the usable ones. */
  comparableLogs: number;
  totalLogs: number;
  /** actual ÷ estimated, averaged. >1 means the user runs long. */
  biasFactor: number;
  /** True once there are enough logs to apply the factor. */
  applied: boolean;
  totalMinutesLogged: number;
  /** Per-class minutes-per-point, where enough has been logged to derive it. */
  minutesPerPointByCourse: Map<string, number>;
}

/**
 * Read every effort log once and reduce it to the numbers estimation needs.
 *
 * Bias is computed as the mean of per-log ratios rather than total-actual over
 * total-estimated: the latter lets one enormous assignment define the factor,
 * which is exactly the pattern a personal calibration should be resistant to.
 */
export async function getCalibration(): Promise<CalibrationSummary> {
  const logs = await prisma.effortLog.findMany({
    select: {
      actualMinutes: true,
      estimatedMinutes: true,
      assignment: { select: { courseId: true, pointsPossible: true } },
    },
  });

  const ratios: number[] = [];
  const perPoint = new Map<string, number[]>();
  let totalMinutes = 0;

  for (const log of logs) {
    totalMinutes += log.actualMinutes;

    if (log.estimatedMinutes && log.estimatedMinutes > 0) {
      ratios.push(log.actualMinutes / log.estimatedMinutes);
    }

    const points = log.assignment.pointsPossible;
    if (points && points > 0) {
      const bucket = perPoint.get(log.assignment.courseId) ?? [];
      bucket.push(log.actualMinutes / points);
      perPoint.set(log.assignment.courseId, bucket);
    }
  }

  const applied = ratios.length >= MIN_LOGS_FOR_BIAS;
  const rawBias = ratios.length > 0 ? average(ratios) : 1;

  return {
    comparableLogs: ratios.length,
    totalLogs: logs.length,
    biasFactor: Math.min(MAX_BIAS, Math.max(MIN_BIAS, rawBias)),
    applied,
    totalMinutesLogged: totalMinutes,
    minutesPerPointByCourse: new Map(
      [...perPoint].map(([courseId, rates]) => [courseId, average(rates)]),
    ),
  };
}

export interface Estimator {
  estimate(assignment: AssignmentLike): EffortEstimate;
  calibration: CalibrationSummary;
}

/**
 * Build an estimator over the whole effort history. One database round trip,
 * then every assignment can be priced synchronously.
 *
 * Precedence, best evidence first:
 *   1. Time logged against this exact assignment.
 *   2. Minutes-per-point logged in this class.
 *   3. The title/points heuristic, scaled by the personal bias factor.
 *
 * A self-reported difficulty multiplies 2 and 3, and deliberately **not** 1.
 * Once you have actually timed yourself on something, that measurement beats
 * your opinion of how hard it was going to be — applying both would count the
 * same difficulty twice, since the reason it took 90 minutes is already in the
 * 90 minutes.
 */
export async function createEstimator(): Promise<Estimator> {
  const [calibration, loggedByAssignment] = await Promise.all([
    getCalibration(),
    prisma.effortLog.groupBy({
      by: ["assignmentId"],
      _avg: { actualMinutes: true },
    }),
  ]);

  const exact = new Map(
    loggedByAssignment
      .filter((row) => row._avg.actualMinutes !== null)
      .map((row) => [row.assignmentId, row._avg.actualMinutes as number]),
  );

  return {
    calibration,
    estimate(assignment) {
      // Measured time wins outright, and is *not* scaled by difficulty: the
      // difficulty is already baked into how long it actually took.
      const logged = exact.get(assignment.id);
      if (logged !== undefined) {
        return { minutes: clamp(logged), source: "logged-assignment" };
      }

      const rated = difficultyFactor(assignment.difficulty);
      const source: EffortSource =
        assignment.difficulty != null ? "rated" : "default";

      const rate = calibration.minutesPerPointByCourse.get(assignment.courseId);
      if (rate !== undefined && assignment.pointsPossible) {
        return {
          minutes: clamp(rate * assignment.pointsPossible * rated),
          source: assignment.difficulty != null ? "rated" : "logged-course",
        };
      }

      const heuristic = defaultEstimate(
        assignment.title,
        assignment.pointsPossible,
      );

      if (calibration.applied) {
        return {
          minutes: clamp(heuristic * calibration.biasFactor * rated),
          source: assignment.difficulty != null ? "rated" : "calibrated",
        };
      }

      return { minutes: clamp(heuristic * rated), source };
    },
  };
}

/** How an estimate's provenance is described to the model, and to the user. */
export const EFFORT_SOURCE_LABEL: Record<EffortSource, string> = {
  "logged-assignment": "from logged time on this assignment",
  "logged-course": "extrapolated from logged time in this class",
  calibrated: "heuristic, adjusted to your logged pace",
  rated: "adjusted by how hard you said this is",
  default: "no logged history, heuristic",
};
