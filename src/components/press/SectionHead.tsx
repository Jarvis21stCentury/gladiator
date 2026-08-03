import type { ReactNode } from "react";

import type { StatusLevel } from "@/lib/status";

import { Plate } from "./Plate";
import { Rule } from "./Rule";

/**
 * A section opening, hung on the margin.
 *
 * The serial sits out in the rail column, the rubric and title hang off the
 * content edge, and a rule draws across above both. Order matters: the rule
 * arrives first and the type strikes into the space it just made, which is the
 * handoff that keeps sections from reading as a stack of unrelated blocks.
 *
 * `description` is not optional in practice. The first version of this page set
 * used titles alone — "The shape of it", "Every class at once" — which read
 * nicely and told you nothing about what the section was or what you could do
 * with it. Every section now says what it is in one plain line, and anything
 * you can interact with says so in `hint`.
 */
export function SectionHead({
  id,
  serial,
  rubric,
  title,
  description,
  hint,
  aside,
  level,
  size = "lg",
}: {
  /** Anchor target for the page contents list. */
  id?: string;
  /** Two digits. The through-line's counterpart in the margin. */
  serial: string;
  rubric: string;
  title: string;
  /** One plain sentence: what this section is. */
  description?: string;
  /** How to use it, when there's something to do here. */
  hint?: string;
  aside?: ReactNode;
  level?: StatusLevel;
  size?: "lg" | "md";
}) {
  const inked = level && level !== "calm";

  return (
    <header
      id={id}
      className="hang mb-[var(--block)] scroll-mt-20"
    >
      <Rule weight={inked ? "status" : "hair"} className="col-span-full mb-6" />

      <p className="serial hidden lg:block" aria-hidden="true">
        {serial}
      </p>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="rubric mb-3">
              <span className="lg:hidden">{serial} · </span>
              {rubric}
            </p>
            <Plate
              as="h2"
              className={`display ${size === "lg" ? "display--lg" : "display--md"}`}
            >
              {title}
            </Plate>
          </div>

          {aside ? <div className="pb-1.5">{aside}</div> : null}
        </div>

        {description ? (
          <p className="prose mt-5 max-w-[56ch] text-ink-soft">{description}</p>
        ) : null}

        {/* Set as an instruction, not a caption. At rubric size this was 11px
            of tracked-out grey and read as a footnote — which is the wrong
            weight for the one line telling you the section is interactive. */}
        {hint ? (
          <p className="mt-3 flex items-baseline gap-2 text-[0.875rem] text-ink">
            <span aria-hidden="true" className="text-ink-soft">
              →
            </span>
            {hint}
          </p>
        ) : null}
      </div>
    </header>
  );
}
