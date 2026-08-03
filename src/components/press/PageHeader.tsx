import type { ReactNode } from "react";

import { serial } from "@/lib/format";

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
 * The almanac was legible and unhelpful. A page opened on a dateline and a
 * beautiful headline, and nowhere did it say what the page was for, what any
 * section did, or where you could go — you had to scroll the whole thing to
 * find out it existed. So every page now leads with one plain sentence and a
 * numbered contents list that doubles as jump links.
 *
 * The contents are the navigation for a long page. They also set expectations
 * before the first scroll, which is most of what "organised" means here.
 */
export function PageHeader({
  eyebrow,
  title,
  purpose,
  meta,
  contents,
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
      <div className="hang">
        <span aria-hidden="true" className="hidden lg:block" />
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
          <div className="docket">{eyebrow}</div>
          {meta ? <div>{meta}</div> : null}
        </div>
      </div>

      <Rule weight="heavy" className="mt-4" />

      <div className="hang mt-[var(--block)]">
        <span aria-hidden="true" className="hidden lg:block" />
        <div>
          <Plate as="h1" className="display display--xl">
            {title}
          </Plate>

          <p className="prose prose--lead mt-6 max-w-[52ch] text-ink-soft">
            {purpose}
          </p>

          {contents && contents.length > 0 ? (
            <nav className="mt-[var(--block)]" aria-label="On this page">
              <p className="rubric mb-3">On this page</p>
              <ol className="flex flex-wrap gap-x-7 gap-y-2">
                {contents.map((section, index) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="group inline-flex items-baseline gap-2 no-underline"
                    >
                      <span className="docket text-[0.625rem] opacity-60">
                        {serial(index + 1)}
                      </span>
                      <span className="border-b border-rule pb-0.5 text-[0.95rem] transition-colors duration-200 group-hover:border-ink">
                        {section.label}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
        </div>
      </div>
    </section>
  );
}
