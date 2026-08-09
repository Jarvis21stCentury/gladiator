"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { courseStyle } from "@/lib/courses/color";
import { STATUS_VAR, type StatusLevel } from "@/lib/status";

import { SECTIONS } from "./nav";

/**
 * The shell's navigation.
 *
 * A persistent sidebar, which is the single biggest change in this version of
 * the design. It replaced a broadsheet masthead — six links in a row above the
 * page, which scrolled away the moment you started reading, so on any long page
 * there was no answer to "where am I" or "how do I get back".
 *
 * It also earns its width by carrying two things a top bar had nowhere to put:
 * the count of what is overdue, next to the section it lives in, and the class
 * list with its colours — which is what makes the colour coding *learnable*
 * rather than a set of unexplained bars on rows.
 *
 * On a phone it degrades to a horizontally scrolling strip at the top. The
 * off-canvas drawer that would be the "proper" answer costs a focus trap, a
 * scroll lock and an escape handler, and this is a single-user tool whose phone
 * use is "check what's due" — one tap, not a navigation session.
 */
export function Sidebar({
  level,
  overdue,
  courses,
}: {
  level: StatusLevel;
  overdue: number;
  courses: { id: string; name: string }[];
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="flex items-center gap-2 px-2 pt-1">
        <Link href="/" data-slip="" className="no-underline">
          <span className="display display--sm">Gladiator</span>
        </Link>
        {/*
          The system's ambient level, but only when it is *not* calm. The mark
          renders hollow at calm, which in the sidebar read as a stray empty
          checkbox next to the product name — a control you could not click.
        */}
        {level !== "calm" ? (
          <span
            className="mark ml-auto"
            data-level={level}
            style={{ "--status": STATUS_VAR[level] } as React.CSSProperties}
            aria-label={`system status: ${level}`}
            role="img"
          />
        ) : null}
      </div>

      <nav aria-label="Sections">
        {/* Scrolls sideways on a phone rather than wrapping to three rows. */}
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {SECTIONS.map((section) => {
            const active =
              section.href === "/"
                ? pathname === "/"
                : pathname.startsWith(section.href);

            return (
              <li key={section.href} className="shrink-0 lg:shrink">
                <Link
                  href={section.href}
                  data-slip=""
                  aria-current={active ? "page" : undefined}
                  className="nav-item whitespace-nowrap"
                >
                  {section.label}
                  {/* Only ever shown where there is something to act on. A nav
                      that carries a zero is a nav that trains you to ignore
                      its numbers. */}
                  {section.href === "/" && overdue > 0 ? (
                    <span
                      className="nav-item__count"
                      style={{ color: STATUS_VAR.urgent }}
                    >
                      {overdue}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {courses.length > 0 ? (
        <div className="hidden lg:block">
          <p className="rubric px-2 pb-2">Classes</p>
          <ul className="flex flex-col">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/classes#course-${course.id}`}
                  data-slip=""
                  className="nav-item"
                >
                  <span
                    className="dot"
                    style={courseStyle(course.name)}
                    aria-hidden="true"
                  />
                  <span className="truncate">{course.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
