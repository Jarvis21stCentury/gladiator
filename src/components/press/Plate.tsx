import type { ElementType } from "react";

/**
 * A display line, optionally ruled.
 *
 * Title Rule is the signature (MOTION.md): a weighted accent rule drawn from the
 * left under the line, a beat after the type has landed. It is the one mark in
 * the system that carries no data, and it earns that by being the thing a ruled
 * page is made of.
 *
 * `mark` is off by default, and that default is the design. One ruled line per
 * page — the page's own name — keeps it meaningful; a rule under every heading
 * is just an underline and stops saying anything.
 *
 * `children` stays a string because the entrance patterns target the line as a
 * single node. The rule itself is an empty, inert element, so nothing is
 * duplicated into the accessibility tree or the clipboard.
 */

type Reveal = "strike" | "none";

export function Plate({
  as: Tag = "span",
  children,
  className = "",
  reveal = "strike",
  mark = false,
}: {
  as?: ElementType;
  children: string;
  className?: string;
  /**
   * `strike` — the whole line rises into place.
   * `none`   — no entrance (for type already inside a scene that moves it).
   *
   * Per-character striking is deliberately not an option here: it belongs to the
   * one masthead on a page, and that lives in `Verdict`.
   */
  reveal?: Reveal;
  /** Draw the accent rule under this line. One per page. */
  mark?: boolean;
}) {
  return (
    <Tag
      className={`plate ${className}`}
      data-strike={reveal === "strike" ? "" : undefined}
      data-mark={mark ? "" : undefined}
    >
      <span className="plate__face">{children}</span>
      {mark ? <span className="plate__rule" aria-hidden="true" /> : null}
    </Tag>
  );
}
