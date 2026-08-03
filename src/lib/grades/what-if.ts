import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The grade "what-if" calculator (FEATURES.md Tier 2) — "what do I need on the
 * final for a B+", computed from actual weighted categories rather than a guess.
 *
 * Two modes, and the UI has to say which one it is using:
 *
 *   WEIGHTED — the syllabus parser gave us category weights, so the answer is
 *     the real one. Earned points are folded per category and the target is
 *     solved inside the category the remaining work belongs to.
 *   FLAT — no weights on record. Every point counts the same. This is an
 *     approximation and is labelled as one, because presenting a flat-points
 *     answer as though it came from the syllabus is the one way this feature
 *     can actively mislead.
 *
 * Nothing here calls a model. It is algebra, and algebra should not cost money
 * or fail when an API is down.
 */

export type WhatIfMode = "weighted" | "flat";

export interface CategoryBreakdown {
  id: string | null;
  name: string;
  weightPercent: number;
  earnedPoints: number;
  gradedPoints: number;
  /** Points in this category that exist but aren't graded yet. */
  remainingPoints: number;
  /** Current percentage inside the category, null when nothing is graded yet. */
  percent: number | null;
}

export interface WhatIfInput {
  courseId: string;
  /** Desired final percentage, 0–100. */
  targetPercent: number;
}

export interface WhatIfResult {
  courseId: string;
  courseName: string;
  mode: WhatIfMode;
  targetPercent: number;
  /** Grade as it stands, from graded work only. */
  currentPercent: number | null;
  categories: CategoryBreakdown[];
  /** Points still ungraded that the answer is solved over. */
  remainingPoints: number;
  /**
   * Percentage needed across all remaining work to land on the target. Above
   * 100 means it is not reachable; below 0 means it is already locked in.
   */
  requiredPercent: number | null;
  reachable: boolean;
  /** Why `requiredPercent` is null, when it is. */
  note: string | null;
}

/** Weights that don't sum to 100 are normalised — syllabi round, or omit a row. */
function normaliseWeights(categories: CategoryBreakdown[]): CategoryBreakdown[] {
  const total = categories.reduce((sum, category) => sum + category.weightPercent, 0);
  if (total <= 0) return categories;

  return categories.map((category) => ({
    ...category,
    weightPercent: (category.weightPercent / total) * 100,
  }));
}

export async function calculateWhatIf({
  courseId,
  targetPercent,
}: WhatIfInput): Promise<WhatIfResult | null> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      gradeCategories: { orderBy: { name: "asc" } },
      assignments: {
        where: { pointsPossible: { gt: 0 } },
        select: {
          id: true,
          title: true,
          pointsPossible: true,
          score: true,
          submitted: true,
          gradeCategoryId: true,
        },
      },
    },
  });

  if (!course) return null;

  const hasWeights =
    course.gradeCategories.length > 0 &&
    course.gradeCategories.some((category) => category.weightPercent > 0);

  const mode: WhatIfMode = hasWeights ? "weighted" : "flat";

  // Bucket assignments. In flat mode everything lands in one implicit bucket
  // weighted 100 — the same maths then produces the flat answer, so there is
  // only one solver to get right.
  const buckets = new Map<string | null, CategoryBreakdown>();

  if (hasWeights) {
    for (const category of course.gradeCategories) {
      buckets.set(category.id, {
        id: category.id,
        name: category.name,
        weightPercent: category.weightPercent,
        earnedPoints: 0,
        gradedPoints: 0,
        remainingPoints: 0,
        percent: null,
      });
    }
  }

  // Assignments with no category (and every assignment in flat mode) fall into
  // an "Uncategorised" bucket rather than being dropped. Silently ignoring
  // points would quietly overstate the grade.
  const fallbackKey: string | null = null;
  buckets.set(fallbackKey, {
    id: null,
    name: hasWeights ? "Uncategorised" : "All work",
    weightPercent: hasWeights ? 0 : 100,
    earnedPoints: 0,
    gradedPoints: 0,
    remainingPoints: 0,
    percent: null,
  });

  for (const assignment of course.assignments) {
    const points = assignment.pointsPossible ?? 0;
    const key = hasWeights && assignment.gradeCategoryId ? assignment.gradeCategoryId : fallbackKey;
    const bucket = buckets.get(key) ?? buckets.get(fallbackKey)!;

    // A score present means it was graded. Submitted-but-ungraded work is
    // "remaining": counting it as zero would read as a catastrophe every time
    // something is handed in on a Friday.
    if (assignment.score !== null) {
      bucket.earnedPoints += assignment.score;
      bucket.gradedPoints += points;
    } else {
      bucket.remainingPoints += points;
    }
  }

  let categories = [...buckets.values()].filter(
    (bucket) =>
      bucket.gradedPoints > 0 || bucket.remainingPoints > 0 || bucket.weightPercent > 0,
  );

  for (const category of categories) {
    category.percent =
      category.gradedPoints > 0
        ? (category.earnedPoints / category.gradedPoints) * 100
        : null;
  }

  if (hasWeights) {
    // Drop an empty uncategorised bucket before normalising, so it can't
    // absorb weight that belongs to the real categories.
    categories = categories.filter(
      (category) =>
        category.id !== null || category.gradedPoints > 0 || category.remainingPoints > 0,
    );
    categories = normaliseWeights(categories);
  }

  const remainingPoints = categories.reduce(
    (sum, category) => sum + category.remainingPoints,
    0,
  );

  // Current standing: weighted mean over categories that have a grade, so an
  // untouched category doesn't drag the average to zero in September.
  const gradedCategories = categories.filter((category) => category.percent !== null);
  const gradedWeight = gradedCategories.reduce(
    (sum, category) => sum + category.weightPercent,
    0,
  );

  const currentPercent =
    gradedWeight > 0
      ? gradedCategories.reduce(
          (sum, category) => sum + (category.percent ?? 0) * category.weightPercent,
          0,
        ) / gradedWeight
      : null;

  if (remainingPoints <= 0) {
    return {
      courseId: course.id,
      courseName: course.name,
      mode,
      targetPercent,
      currentPercent,
      categories,
      remainingPoints: 0,
      requiredPercent: null,
      reachable: currentPercent !== null && currentPercent >= targetPercent,
      note: "There is no ungraded work left in this class — the grade is what it is.",
    };
  }

  // Solve for x, the fraction earned on all remaining points:
  //   target = Σ_c w_c · (earned_c + x · remaining_c) / (graded_c + remaining_c)
  // Every term is linear in x, so evaluate the weighted total at x = 0 and
  // x = 1 and interpolate. This holds in both modes without a special case.
  const totalWeight = categories.reduce((sum, category) => sum + category.weightPercent, 0);

  const scoreAt = (x: number): number => {
    let weighted = 0;
    let usedWeight = 0;

    for (const category of categories) {
      const possible = category.gradedPoints + category.remainingPoints;
      if (possible <= 0) continue;

      const earned = category.earnedPoints + x * category.remainingPoints;
      weighted += (earned / possible) * 100 * category.weightPercent;
      usedWeight += category.weightPercent;
    }

    return usedWeight > 0 ? weighted / usedWeight : 0;
  };

  const atZero = scoreAt(0);
  const atOne = scoreAt(1);
  const span = atOne - atZero;

  if (totalWeight <= 0 || span <= 0) {
    return {
      courseId: course.id,
      courseName: course.name,
      mode,
      targetPercent,
      currentPercent,
      categories,
      remainingPoints,
      requiredPercent: null,
      reachable: false,
      note: "The remaining work carries no weight, so it cannot move the grade.",
    };
  }

  const requiredPercent = ((targetPercent - atZero) / span) * 100;

  return {
    courseId: course.id,
    courseName: course.name,
    mode,
    targetPercent,
    currentPercent,
    categories,
    remainingPoints,
    requiredPercent,
    reachable: requiredPercent <= 100,
    note:
      requiredPercent < 0
        ? "Already locked in — even a zero on everything left clears this target."
        : null,
  };
}

/** Common targets, so the UI doesn't need a number pad to be useful. */
export const GRADE_TARGETS = [
  { label: "A", percent: 93 },
  { label: "A−", percent: 90 },
  { label: "B+", percent: 87 },
  { label: "B", percent: 83 },
  { label: "C", percent: 73 },
] as const;
