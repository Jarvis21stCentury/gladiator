import type { ElementType } from "react";

/**
 * Plate Registration — the signature (MOTION.md).
 *
 * Display type prints as two impressions: the ink plate, and a ghost of the
 * signal plate sitting behind it and slightly out of register. On entrance the
 * ghost converges into alignment; afterwards it drifts back out proportionally
 * to scroll velocity, so the whole page leans as one organism when you move.
 *
 * The ghost is a duplicate of the text, which is why `children` is a string:
 * duplicating arbitrary nodes would mean duplicating ids, inputs and links into
 * the accessibility tree. It is `aria-hidden` and inert — screen readers and
 * text selection only ever see the face.
 */

type Reveal = "strike" | "none";

export function Plate({
  as: Tag = "span",
  children,
  className = "",
  reveal = "strike",
}: {
  as?: ElementType;
  children: string;
  className?: string;
  /**
   * `strike` — the whole line rises from behind its rule.
   * `none`   — registration only, no entrance (for type already inside a scene).
   *
   * Per-character striking is deliberately not an option here: it belongs to the
   * one masthead on a page, and that lives in `Verdict`.
   */
  reveal?: Reveal;
}) {
  return (
    <Tag
      className={`plate ${className}`}
      data-strike={reveal === "strike" ? "" : undefined}
    >
      <span className="plate__ghost" aria-hidden="true">
        {children}
      </span>
      <span className="plate__face">{children}</span>
    </Tag>
  );
}
