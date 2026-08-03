import Link from "next/link";

import { serial } from "@/lib/format";

import { SECTIONS } from "./nav";

/**
 * The colophon.
 *
 * A printed index of the five sections and what each one is for, closing every
 * page. It does the work a footer normally does badly: it is the only place the
 * whole product is described in one view, which matters in a tool where four of
 * the five pages are things you arrive at from somewhere else.
 */
export function Colophon() {
  return (
    <footer className="band mt-[var(--section)]">
      <div className="sheet py-[var(--block)]">
        <div className="hang">
          <p className="rubric hidden lg:block">Index</p>

          <div>
            <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {SECTIONS.map((section, index) => (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    data-slip=""
                    className="group block no-underline"
                  >
                    <span className="docket text-[0.625rem]">
                      {serial(index + 1)}
                    </span>
                    <span className="display display--sm mt-1 block">
                      {section.label}
                    </span>
                    <span className="rubric mt-1 block normal-case tracking-normal">
                      {section.note}
                    </span>
                    <span className="mt-2 block h-px w-6 bg-rule transition-[width,background-color] duration-300 ease-[var(--strike)] group-hover:w-full group-hover:bg-ink" />
                  </Link>
                </li>
              ))}
            </ul>

            <p className="docket mt-[var(--block)]">
              Gladiator · single user, no login · Canvas + Google Calendar +
              Prisma Postgres
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
