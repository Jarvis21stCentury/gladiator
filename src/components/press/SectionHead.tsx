import type { ReactNode } from "react";

import { STATUS_VAR, type StatusLevel } from "@/lib/status";

import { Plate } from "./Plate";

/**
 * A section opening.
 *
 * One line: the title, and whatever control belongs to the section.
 *
 * `rubric`, `description` and `hint` are still accepted and deliberately not
 * rendered. Every section carried a small-caps label that restated its own
 * title ("Right now" / THE SHORT ANSWER), a sentence explaining what the
 * section was, and sometimes a line explaining how to use it — three pieces of
 * text above every block of content, none of which said anything the content
 * did not. Read once, then noise forever.
 *
 * They are kept on the interface rather than deleted because all six pages pass
 * them, and accepting-and-ignoring is far cheaper than editing every call site.
 * If a section ever genuinely needs a sentence, render `description` again —
 * but the bar is "this cannot be understood without it".
 *
 * `description` is not optional in practice. The first version of this page set
 * used titles alone — "The shape of it", "Every class at once" — which read
 * nicely and told you nothing about what the section was or what you could do
 * with it. Every section now says what it is in one plain line, and anything
 * you can interact with says so in `hint`.
 */
export function SectionHead({
  id,
  title,
  aside,
  level,
  size = "lg",
}: {
  /** Anchor target for the page contents list. */
  id?: string;
  /**
   * Two digits. Deliberately accepted and ignored: the margin rail this numbered
   * is gone, but all six pages still pass it, and silently accepting it is far
   * cheaper than editing every call site to delete a prop.
   */
  serial?: string;
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
    <header id={id} className="mb-3 scroll-mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          {/* The status tick replaces the ruled status bar that used to run the
              full width above every section. Same information, no furniture. */}
          {inked ? (
            <span
              className="h-3.5 w-[3px] rounded-sm"
              style={{ background: STATUS_VAR[level] }}
              aria-hidden="true"
            />
          ) : null}
          <Plate
            as="h2"
            className={`display ${size === "lg" ? "display--lg" : "display--md"}`}
          >
            {title}
          </Plate>
        </div>

        {aside ? <div>{aside}</div> : null}
      </div>

    </header>
  );
}
