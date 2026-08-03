"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { serial } from "@/lib/format";

import { SECTIONS } from "./nav";

/**
 * The nameplate.
 *
 * A broadsheet masthead rather than a product navbar: the title sits left, the
 * five sections run as a numbered index to the right, and one heavy rule
 * separates the whole thing from the page. The current section is the only
 * inked entry, so you can find where you are without reading anything.
 *
 * Deliberately not translucent. A `backdrop-filter` on a sticky bar repaints
 * every frame you scroll, and this page has a pinned chart scene to pay for.
 */
export function Masthead() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-paper" data-masthead="">
      <div className="sheet">
        {/* Stacks on a phone. Five section labels and a nameplate will not share
            a 390px line without colliding, and a masthead that overlaps itself
            is the first thing anyone notices. */}
        <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-3">
          <Link
            href="/"
            data-slip=""
            className="flex items-baseline gap-3 no-underline"
          >
            <span className="display display--sm whitespace-nowrap">
              Gladiator
            </span>
            <span className="docket hidden text-[0.625rem] sm:inline">
              an almanac
            </span>
          </Link>

          <nav aria-label="Sections">
            <ul className="flex items-baseline gap-x-3 gap-y-1 sm:gap-x-6">
              {SECTIONS.map((section, index) => {
                const active =
                  section.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(section.href);

                return (
                  <li key={section.href}>
                    <Link
                      href={section.href}
                      data-slip=""
                      aria-current={active ? "page" : undefined}
                      className="group flex items-baseline gap-1.5 no-underline"
                    >
                      <span
                        className="docket hidden text-[0.5625rem] sm:inline"
                        style={{ opacity: active ? 1 : 0.5 }}
                      >
                        {serial(index + 1)}
                      </span>
                      <span
                        className="rubric transition-colors duration-200"
                        style={{ color: active ? "var(--ink)" : undefined }}
                      >
                        {/* The first word alone on a phone — five full labels
                            would wrap the nameplate onto three lines. */}
                        <span className="hidden sm:inline">{section.label}</span>
                        <span className="sm:hidden">
                          {section.label.split(" ")[0]}
                        </span>
                      </span>
                      <span
                        className="hidden h-px w-0 bg-ink transition-[width] duration-300 ease-[var(--strike)] group-hover:w-3 sm:block"
                        style={{ width: active ? "0.75rem" : undefined }}
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>

      <span className="block h-px w-full bg-ink" />
    </header>
  );
}
