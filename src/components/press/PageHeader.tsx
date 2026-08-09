import type { ReactNode } from "react";

import { Plate } from "./Plate";
import { Rule } from "./Rule";

export interface PageSection {
  /** Anchor id on the matching SectionHead. */
  id: string;
  label: string;
}

/**
 * The top of every page: what this page is, and what's on it.
 *
 * The old front matter was legible and unhelpful. A page opened on a dateline and a
 * beautiful headline, and nowhere did it say what the page was for, what any
 * section did, or where you could go — you had to scroll the whole thing to
 * find out it existed. So every page now leads with one plain sentence and a
 * numbered contents list that doubles as jump links.
 *
 * `purpose` and `contents` are accepted and deliberately not rendered.
 *
 * The purpose line explained what the page was for — read once, then a sentence
 * you scroll past forever. The contents list was in-page navigation from before
 * there was a sidebar, and a second nav that only covers the page you are
 * already on costs a row of links to save one scroll.
 *
 * Kept on the interface because all six pages pass them; see SectionHead for
 * the same reasoning.
 */
export function PageHeader({
  eyebrow,
  title,
  meta,
}: {
  /** Small label above the rule — the dateline, the range, the count. */
  eyebrow: ReactNode;
  title: string;
  /** One sentence, plain language: what this page is for. */
  purpose: string;
  /** Controls that belong to the whole page (date paging, etc). */
  meta?: ReactNode;
  contents?: PageSection[];
}) {
  return (
    <section className="sheet pt-[var(--block)]">
      {/* Title, purpose and page state on one band, then the rule. This used to
          be a full screen: a dateline, a 4.75rem headline, a lead paragraph and
          a numbered contents list, before a single piece of data. */}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2">
        <div className="min-w-0">
          <div className="docket text-[0.6875rem]">{eyebrow}</div>
          <Plate as="h1" className="display display--xl mt-1" mark>
            {title}
          </Plate>
        </div>

        {meta ? <div className="shrink-0 pt-1">{meta}</div> : null}
      </div>

      <Rule className="mt-[var(--block)]" />
    </section>
  );
}
