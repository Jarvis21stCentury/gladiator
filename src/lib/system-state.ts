import "server-only";

import { prisma } from "@/lib/prisma";
import { getActiveStruggles, worstLevel, type ActiveStruggle } from "@/lib/struggles/engine";
import {
  levelForLoad,
  levelFromSeverity,
  maxLevel,
  rankOf,
  type StatusLevel,
} from "@/lib/status";
import { getWorkloadForecast, type WorkloadForecast } from "@/lib/workload/forecast";

/**
 * What the front page's verdict is actually reading (FEATURES.md).
 *
 * The spec is explicit that the system's headline state is "driven by current
 * StruggleFlag severity + near-term workload density", so this is that one
 * calculation, in one place, exported as a small serialisable object. The
 * components that render it do no data work — they only know how to print a
 * level and a headline.
 */

/** Workload beyond today that still counts as "near-term" for the verdict. */
const NEAR_TERM_DAYS = 4;

export interface SystemState {
  level: StatusLevel;
  /**
   * 0–1. How hard the week is pushing, distinct from `level`: a calm-but-busy
   * week is not warming, but it is not nothing either.
   */
  agitation: number;
  /** One line naming the reason — the front page's masthead verdict. */
  headline: string;
  struggleCount: number;
  worstStruggle: ActiveStruggle | null;
  /** Minutes of work due in the near-term window. */
  nearTermMinutes: number;
  nearTermRatio: number;
}

export interface SystemStateSources {
  struggles: ActiveStruggle[];
  forecast: WorkloadForecast;
}

function describe(
  level: StatusLevel,
  worst: ActiveStruggle | null,
  forecast: WorkloadForecast,
  ratio: number,
): string {
  if (worst && rankOf(worst.level) >= rankOf(level)) return worst.title;

  const peak = forecast.peak;

  if (level === "urgent" && peak) {
    return `${peak.date.toLocaleDateString(undefined, { weekday: "long" })} is overloaded`;
  }

  if (level === "warming") {
    return ratio >= 0.9
      ? "Workload is building over the next few days"
      : "Something needs attention";
  }

  return forecast.totalMinutes > 0 ? "On track" : "Nothing due — all clear";
}

export function deriveSystemState({
  struggles,
  forecast,
}: SystemStateSources): SystemState {
  const nearTerm = forecast.days.filter((day) => day.offset < NEAR_TERM_DAYS);

  const nearTermMinutes = nearTerm.reduce((sum, day) => sum + day.loadMinutes, 0);
  const nearTermCapacity = nearTerm.reduce(
    (sum, day) => sum + day.capacityMinutes,
    0,
  );
  const nearTermRatio =
    nearTermCapacity > 0 ? nearTermMinutes / nearTermCapacity : 0;

  const struggleLevel = worstLevel(struggles);
  const loadLevel = levelForLoad(nearTermRatio);
  const level = maxLevel(struggleLevel, loadLevel);

  // Agitation blends the two inputs rather than tracking level alone, so the
  // motion carries information the colour doesn't: a single critical flag in an
  // otherwise empty week reads as urgent but unhurried, which is accurate.
  const struggleWeight =
    struggles.length === 0
      ? 0
      : Math.min(1, struggles.reduce((sum, s) => sum + s.severity, 0) / 8);
  const loadWeight = Math.min(1, nearTermRatio / 1.5);

  const worstStruggle = struggles[0] ?? null;

  return {
    level,
    agitation: Math.min(1, Math.max(0, struggleWeight * 0.6 + loadWeight * 0.6)),
    headline: describe(level, worstStruggle, forecast, nearTermRatio),
    struggleCount: struggles.length,
    worstStruggle,
    nearTermMinutes,
    nearTermRatio,
  };
}

/**
 * Just the ink, for the chrome that appears on every page — the through-line rail in the
 * margin (MOTION.md → Through-Line Rail).
 *
 * One indexed query rather than the full `getSystemState()`, because this runs in the
 * root layout on every navigation and the pages that need the whole picture fetch it
 * themselves. The rail's job is to keep the system's state on screen wherever you have
 * navigated to; that only needs the worst live severity.
 */
export async function getAmbientLevel(): Promise<StatusLevel> {
  const worst = await prisma.struggleFlag.findFirst({
    where: { resolved: false },
    orderBy: { severity: "desc" },
    select: { severity: true },
  });

  return worst ? levelFromSeverity(worst.severity) : "calm";
}

export async function getSystemState(): Promise<
  SystemState & { forecast: WorkloadForecast; struggles: ActiveStruggle[] }
> {
  const [struggles, forecast] = await Promise.all([
    getActiveStruggles(),
    getWorkloadForecast(),
  ]);

  return { ...deriveSystemState({ struggles, forecast }), forecast, struggles };
}
