/**
 * The rule.
 *
 * This is the structural vocabulary of the whole product — pages are built from
 * hairlines and a hanging margin, not from boxes. Every rule draws itself in
 * from the left on entry (MOTION.md → Rule Draw), always slightly *before* the
 * type it introduces, which is what makes a section feel authored rather than
 * assembled.
 */
export function Rule({
  weight = "hair",
  className = "",
  animate = true,
}: {
  /** `status` inks the rule with the current level — use it sparingly. */
  weight?: "hair" | "heavy" | "status";
  className?: string;
  animate?: boolean;
}) {
  return (
    <span
      className={`rule-h ${className}`}
      data-weight={weight}
      data-draw={animate ? "" : undefined}
      aria-hidden="true"
    />
  );
}
