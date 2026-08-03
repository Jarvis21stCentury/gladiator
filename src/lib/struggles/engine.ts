import "server-only";

import { prisma } from "@/lib/prisma";
import { levelFromSeverity, maxLevel, type StatusLevel } from "@/lib/status";
import { detectStruggles, type DetectedStruggle } from "./detect";
import { explainStruggles } from "./explain";

/**
 * Persistence for the struggles engine: run the rules, reconcile them against
 * what is already on record, and explain only what actually changed.
 *
 * Reconciliation matters more than it looks. Detection runs on every cron and
 * every dashboard load; inserting a row each time would turn "3 assignments
 * missed" into fifty identical flags in a week. Each rule emits a stable
 * `signature` for the *condition*, so a repeat detection updates one row, and a
 * condition that stops being detected resolves itself without the user having
 * to dismiss anything.
 */

export interface RunStrugglesResult {
  detected: number;
  created: number;
  updated: number;
  autoResolved: number;
  explained: number;
  /** Set when the rewrite step failed; flags still land, with rules prose. */
  explainError: string | null;
}

/** Evidence equality — cheap, and only used to decide whether to re-explain. */
function sameEvidence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

export async function runStruggleDetection(
  options: { explain?: boolean } = {},
): Promise<RunStrugglesResult> {
  const { explain = true } = options;
  const runAt = new Date();

  const detected = await detectStruggles();
  const existing = await prisma.struggleFlag.findMany({
    where: { signature: { in: detected.map((flag) => flag.signature) } },
  });

  const bySignature = new Map(existing.map((flag) => [flag.signature, flag]));

  // Only pay for a rewrite when there is something new to say: a flag we have
  // never seen, one whose evidence moved, or one still carrying rules prose
  // from a run where the model was unreachable.
  const needsExplaining = detected.filter((flag) => {
    const prior = bySignature.get(flag.signature);
    if (!prior) return true;
    if (prior.explainedBy !== "llm") return true;
    return !sameEvidence(prior.evidence, flag.evidence);
  });

  let explanations = new Map<string, string>();
  let explainError: string | null = null;

  if (explain && needsExplaining.length > 0) {
    const result = await explainStruggles(needsExplaining);
    explanations = result.descriptions;
    explainError = result.error;
  }

  let created = 0;
  let updated = 0;

  for (const flag of detected) {
    const rewritten = explanations.get(flag.signature);
    const prior = bySignature.get(flag.signature);

    // Keep a good explanation from an earlier run rather than overwriting it
    // with the rules sentence when this run couldn't reach the model.
    const keepPrior =
      !rewritten && prior?.explainedBy === "llm" && sameEvidence(prior.evidence, flag.evidence);

    const description = rewritten ?? (keepPrior ? prior.description : flag.description);
    const explainedBy = rewritten ? "llm" : keepPrior ? "llm" : "rules";

    await prisma.struggleFlag.upsert({
      where: { signature: flag.signature },
      create: {
        signature: flag.signature,
        type: flag.type,
        courseId: flag.courseId,
        severity: flag.severity,
        title: flag.title,
        description,
        evidence: flag.evidence,
        explainedBy,
        detectedAt: runAt,
        lastSeenAt: runAt,
      },
      update: {
        severity: flag.severity,
        title: flag.title,
        description,
        evidence: flag.evidence,
        explainedBy,
        lastSeenAt: runAt,
        // A condition that came back after resolving is live again, but keep
        // the original detectedAt so "open since" stays honest.
        resolved: false,
        resolvedAt: null,
      },
    });

    if (prior) updated += 1;
    else created += 1;
  }

  // Anything this run didn't detect has cleared. The work got handed in, the
  // grade recovered, the busy day passed.
  const { count: autoResolved } = await prisma.struggleFlag.updateMany({
    where: { resolved: false, lastSeenAt: { lt: runAt } },
    data: { resolved: true, resolvedAt: runAt },
  });

  return {
    detected: detected.length,
    created,
    updated,
    autoResolved,
    explained: explanations.size,
    explainError,
  };
}

export interface ActiveStruggle {
  id: string;
  type: string;
  title: string;
  description: string;
  evidence: string[];
  severity: number;
  level: StatusLevel;
  courseId: string | null;
  courseName: string | null;
  detectedAt: Date;
  explainedBy: string;
}

export async function getActiveStruggles(): Promise<ActiveStruggle[]> {
  const flags = await prisma.struggleFlag.findMany({
    where: { resolved: false },
    orderBy: [{ severity: "desc" }, { detectedAt: "asc" }],
    include: { course: { select: { name: true } } },
  });

  return flags.map((flag) => ({
    id: flag.id,
    type: flag.type,
    title: flag.title,
    description: flag.description,
    evidence: flag.evidence,
    severity: flag.severity,
    level: levelFromSeverity(flag.severity),
    courseId: flag.courseId,
    courseName: flag.course?.name ?? null,
    detectedAt: flag.detectedAt,
    explainedBy: flag.explainedBy,
  }));
}

/** Highest live severity, as a level. `calm` when nothing is flagged. */
export function worstLevel(struggles: ActiveStruggle[]): StatusLevel {
  return maxLevel(...struggles.map((struggle) => struggle.level));
}

export type { DetectedStruggle };
