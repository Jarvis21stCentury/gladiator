/**
 * Through-Line Rail (MOTION.md).
 *
 * A hairline down the hanging margin, present on every page, filling with scroll
 * progress and inked with the system's current level. It is the single most
 * effective device for making a five-page tool read as one document: whatever
 * you are looking at, the same rail is running down the margin beside it, at the
 * same colour the dashboard was.
 *
 * Pure markup. It is driven entirely by the `--progress` and `--status` custom
 * properties the press writes, so it costs nothing per frame and degrades to a
 * static hairline with no JavaScript.
 */
export function Throughline() {
  return (
    <div className="throughline" aria-hidden="true">
      <span className="throughline__fill" />
      <span className="throughline__head" />
    </div>
  );
}
