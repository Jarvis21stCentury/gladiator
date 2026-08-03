import { STATUS_VAR, levelForGrade } from "@/lib/status";

/**
 * A grade, printed as a measured bar against a ruled scale.
 *
 * A dial would make you estimate an angle; a bar against ticks at 70 / 80 / 90
 * lets you read the grade *and* its distance from the next band in one look,
 * which is the actual question ("am I about to drop a letter?"). The scale
 * starts at 50 because the bottom half of a grade axis is dead space nobody has
 * ever needed to compare within.
 */

const FLOOR = 50;
const TICKS = [70, 80, 90];

export function Meter({
  percent,
  label,
  caption,
  compact = false,
}: {
  percent: number | null;
  label: string;
  /** e.g. a trend delta — set small under the scale. */
  caption?: string;
  compact?: boolean;
}) {
  const level = levelForGrade(percent);
  const inked = level !== "calm";
  const fill =
    percent === null
      ? 0
      : Math.max(0, Math.min(1, (percent - FLOOR) / (100 - FLOOR)));

  return (
    <div data-press="">
      <div className="flex items-baseline justify-between gap-4">
        <p className={compact ? "rubric" : "text-[0.95rem] leading-tight"}>
          {label}
        </p>
        <p
          className="fig--lg fig"
          style={inked ? { color: STATUS_VAR[level] } : undefined}
        >
          {percent === null ? "—" : `${percent.toFixed(1)}`}
          {percent !== null ? (
            <span className="display--sm align-top opacity-45">%</span>
          ) : null}
        </p>
      </div>

      <div className="relative mt-3 h-[9px]">
        {/* The scale. */}
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule" />

        {TICKS.map((tick) => (
          <span
            key={tick}
            className="absolute top-0 h-full w-px bg-rule"
            style={{ left: `${((tick - FLOOR) / (100 - FLOOR)) * 100}%` }}
            aria-hidden="true"
          />
        ))}

        {/* The reading. Grows from the floor of the scale on entry. */}
        <span
          className="absolute left-0 top-1/2 h-[3px] origin-left -translate-y-1/2"
          data-meter=""
          style={{
            width: `${fill * 100}%`,
            background: inked ? STATUS_VAR[level] : "var(--ink)",
          }}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <span className="docket text-[0.625rem] opacity-60">{FLOOR}</span>
        {caption ? <span className="docket text-[0.625rem]">{caption}</span> : null}
        <span className="docket text-[0.625rem] opacity-60">100</span>
      </div>
    </div>
  );
}
