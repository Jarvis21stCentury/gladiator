import { STATUS_LABEL, STATUS_VAR, type StatusLevel } from "@/lib/status";

/**
 * The status mark — a printed lozenge, filled when a signal ink is in play and
 * hollow when things are simply fine.
 *
 * Nothing here glows or pulses. In the ink language a calm page prints in one
 * colour, so the mark's *presence as ink* is the signal; making every mark
 * bright would spend the reader's attention on the 90% of rows that are fine.
 */
export function Mark({
  level,
  shape,
  label,
  ink,
}: {
  level: StatusLevel;
  /** `miss` strikes the mark through, so the week replay reads without colour. */
  shape?: "miss";
  label?: string;
  /**
   * Explicit ink, for the cases the ladder does not cover — `AFFIRM_VAR` on the
   * retro's wins, which are positive rather than "warming". Without this the
   * mark always re-derived its own ink from `level` and quietly overrode
   * whatever the caller had set on the row, so every win printed ochre.
   */
  ink?: string;
}) {
  return (
    <span
      className="mark"
      data-level={ink ? "inked" : level}
      data-shape={shape}
      style={{ "--status": ink ?? STATUS_VAR[level] } as React.CSSProperties}
      role="img"
      aria-label={label ?? STATUS_LABEL[level]}
    />
  );
}
