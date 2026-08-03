import { STATUS_VAR, type StatusLevel } from "@/lib/status";

import { Tally } from "./Tally";

/**
 * A reading: rubric above, figure below, note underneath.
 *
 * The almanac's core unit. The label is set small and tracked wide so the figure
 * can be as large as it wants without the pair reading as two competing pieces
 * of type — a caption and its subject, not a heading and a value.
 */
export function Figure({
  label,
  value,
  tally,
  hint,
  level,
  size = "md",
  className = "",
}: {
  label: string;
  /** Pre-formatted display value. Used as-is, and as the no-JS value for a tally. */
  value: string;
  /** Numeric target — supply it and the figure counts up to `value` on entry. */
  tally?: { to: number; decimals?: number; prefix?: string; suffix?: string };
  hint?: string;
  level?: StatusLevel;
  size?: "md" | "lg";
  className?: string;
}) {
  const inked = level && level !== "calm";

  return (
    <div className={className} data-press="">
      <p className="rubric">{label}</p>
      <p
        className={`mt-2 ${size === "lg" ? "fig--lg" : "display display--sm fig"}`}
        style={inked ? { color: STATUS_VAR[level] } : undefined}
      >
        {tally ? <Tally {...tally} /> : value}
      </p>
      {hint ? <p className="docket mt-1.5">{hint}</p> : null}
    </div>
  );
}
