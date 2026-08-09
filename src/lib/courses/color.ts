/**
 * Which colour a class is.
 *
 * Colour-coding subjects is the one convention every student tool worth using
 * shares, and it is not decoration: it is the fastest possible answer to "is
 * this row mine to worry about", and it measurably lowers the cost of scanning
 * a mixed list of six classes' work.
 *
 * Two rules from CLAUDE.md make it safe to sit alongside the status ladder:
 *
 *   1. The palette contains no red, no amber and no green. Those belong to
 *      `calm → warming → urgent`, and a Biology row that happened to print green
 *      must never be mistaken for a submitted one.
 *   2. Course colour only ever appears as a bar or a dot at a row's left edge.
 *      Status ink only ever appears as text or a mark. Two systems, two slots —
 *      they cannot be confused because they never share a position.
 *
 * ## Why this is a CSS variable map rather than a hash
 *
 * The obvious implementation is `hash(name) % 8`, and it was the first one. It
 * is wrong for a reason worth writing down: with eight colours and the six
 * classes a person actually takes, the birthday paradox gives you roughly a 78%
 * chance that *some* pair collides. In practice three of six classes rendered
 * the same slate and the feature quietly stopped working.
 *
 * So the assignment is by position in the sorted class list, which guarantees
 * distinct colours for up to eight classes. The layout emits the resulting map
 * once as custom properties on :root, and every call site just references
 * `var(--course-<slug>)`. That keeps it working in server components with no
 * context, no prop drilling and no per-row lookup — a `<DocketRow>` deep inside
 * a page it knows nothing about still gets the right colour from a string.
 *
 * The fallback in the `var()` matters: a course that is not in the map (renamed
 * mid-sync, or a row naming something that was never a class) gets a neutral
 * rule colour rather than an unstyled bar.
 *
 * No "server-only": client components need this too.
 */

/** How many `--course-N` custom properties exist in globals.css. */
export const COURSE_COLORS = 8;

/**
 * Course name → CSS custom-property name fragment.
 *
 * Lowercased and stripped to `[a-z0-9]+` so the three sources a course name can
 * arrive from — the Canvas API, an iCal feed and a syllabus PDF — agree.
 * "AP Calculus AB", "ap calculus ab " and "AP  Calculus  AB" all slug the same.
 */
export function courseSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The `:root` declarations mapping every known class to a distinct colour.
 *
 * Rendered once by the root layout. Sorted by name rather than by id so the
 * assignment is stable across re-syncs — Canvas ids are not guaranteed to come
 * back in the same order, and a class that changed colour on every sync would
 * be worse than no colour at all.
 */
export function courseColorVars(courses: { name: string }[]): string {
  const seen = new Set<string>();
  const declarations: string[] = [];

  const sorted = [...courses].sort((a, b) => a.name.localeCompare(b.name));

  for (const course of sorted) {
    const slug = courseSlug(course.name);
    // Two classes whose names slug identically would otherwise emit the same
    // property twice, and the last one would win for both.
    if (!slug || seen.has(slug)) continue;

    declarations.push(
      `--course-${slug}:var(--course-${(seen.size % COURSE_COLORS) + 1})`,
    );
    seen.add(slug);
  }

  return declarations.length ? `:root{${declarations.join(";")}}` : "";
}

/** A CSS reference to this course's colour, falling back to a neutral rule. */
export function courseColor(name: string | null | undefined): string {
  if (!name) return "var(--rule)";

  const slug = courseSlug(name);
  if (!slug) return "var(--rule)";

  return `var(--course-${slug}, var(--rule))`;
}

/** The inline style that paints a `.chip` / `.dot` for a course. */
export function courseStyle(
  name: string | null | undefined,
): React.CSSProperties {
  return { "--course": courseColor(name) } as React.CSSProperties;
}
