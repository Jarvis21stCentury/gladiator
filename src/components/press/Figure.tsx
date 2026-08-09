import { STATUS_VAR, type StatusLevel } from "@/lib/status";

import { Tally } from "./Tally";

/**
 * A metric tile: label, number, note.
 *
 * Now an actual surface rather than three lines of type floating on the page.
 * That is the whole difference between "five numbers somewhere on a page" and a
 * KPI strip you read in one pass — the reference pattern is four to six of these
 * above the fold, each with one number and nothing competing with it.
 *
 * The figure is deliberately capped at 2rem. It used to run to 4.75rem, which
 * made five of them the entire first screen.
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
    <div className={`tile ${className}`} data-press="">
      <p className="rubric truncate">{label}</p>
      <p
        className={`mt-1.5 fig ${size === "lg" ? "fig--lg" : "display display--md"}`}
        style={inked ? { color: STATUS_VAR[level] } : undefined}
      >
        {tally ? <Tally {...tally} /> : value}
      </p>
      {hint ? (
        <p className="mt-1 text-[0.75rem] leading-snug text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}
