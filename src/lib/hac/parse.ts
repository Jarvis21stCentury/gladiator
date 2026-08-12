/**
 * Reading grades out of a Home Access Center page.
 *
 * Pure string work, no `server-only`, no network — which is the point. This is
 * the part of the HAC integration most likely to be wrong, because HAC is not
 * one product: it is eSchoolPlus rendered by whatever version and theme a
 * district happens to run, and the markup differs between them. Keeping the
 * parsing separate from the fetching means it can be tested against real saved
 * HTML and corrected without touching login, cookies or storage.
 *
 * ## Why regex and not a DOM parser
 *
 * No HTML parser is in the dependency tree, and adding one to read two fields
 * off one page is not worth it. These patterns are deliberately loose — they
 * look for the *shape* of a course row rather than exact class names — because
 * a strict selector against a district theme nobody here has seen would be
 * false precision.
 *
 * If this returns nothing for your portal, that is expected to be a
 * one-adjustment problem: save the grades page as HTML, look at what a course
 * row actually is, and add a pattern here.
 */

export interface HacCourse {
  /** As printed in HAC, e.g. "AP Calculus AB" or "1234 - Algebra II". */
  name: string;
  /** The percent, when the page shows one. */
  percent: number | null;
}

/** Collapse entities and whitespace so comparisons are about words. */
export function cleanText(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip the course-code prefix districts put in front of names.
 *
 * "1234 - AP Calculus AB" and "AP Calculus AB" have to match the same class, or
 * every sync creates a duplicate. Only strips a *leading* code followed by a
 * separator, so "Algebra 2 - Honors" keeps both halves.
 */
export function tidyCourseName(raw: string): string {
  const text = cleanText(raw);

  /*
   * A leading code is an unbroken alphanumeric token containing at least one
   * digit, followed by a separator: "1234 - ", "CHEM01 - ", "MA2100: ".
   *
   * The digit requirement is what protects real names. "Algebra 2 - Honors"
   * survives because the token before the dash contains a space, and a purely
   * alphabetic prefix like "Honors - Biology" survives because it has no digit.
   */
  const withoutCode = text.replace(
    /^(?=[A-Z0-9]*\d)[A-Z0-9]{2,12}\s*[-–—:]\s*/i,
    "",
  );

  return (withoutCode || text).trim();
}

/**
 * A percent from a cell that might say "93.5", "93.5%", "A (93.5)" or "A".
 * Returns null rather than guessing when there is no number — a letter grade
 * with no percentage is a real HAC state, and inventing 95 for an "A" would put
 * a fabricated number into the grade trend.
 */
export function parsePercent(raw: string): number | null {
  const text = cleanText(raw);
  const match = text.match(/(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 150) return null;

  return value;
}

/** Rows whose "name" is actually furniture. */
const NOT_A_COURSE =
  /^(course|class|period|teacher|room|grade|average|marking period|report card|assignment|total|semester|quarter|term|credits?)$/i;

function plausibleCourseName(name: string): boolean {
  if (name.length < 3 || name.length > 80) return false;
  if (NOT_A_COURSE.test(name)) return false;

  /*
   * A percent sign means this is a mark, not a name. HAC's own markup is the
   * reason: the average is rendered in a span carrying the *same* heading class
   * as the course title, so "Student Grades 88.62%" was being registered as a
   * course in its own right — every real class then appeared twice, once with
   * no grade.
   */
  if (/%/.test(name)) return false;
  if (/^student grades?\b/i.test(name)) return false;

  // Needs at least one letter — a bare period number is not a class name.
  return /[a-z]/i.test(name);
}

/**
 * Pull courses and percentages out of a HAC grades page.
 *
 * Two passes, because HAC shows grades in two quite different places and which
 * one a district exposes varies:
 *
 *   1. The classic "Report Card"/"Grades" table — rows of cells.
 *   2. The newer Assignments view, where each course is a panel with the
 *      average in its header.
 *
 * Results are merged by course name, first non-null percent winning, so a page
 * containing both shapes does not produce duplicates.
 */
export function parseHacGrades(html: string): HacCourse[] {
  const found = new Map<string, HacCourse>();

  const add = (rawName: string, percent: number | null) => {
    const name = tidyCourseName(rawName);
    if (!plausibleCourseName(name)) return;

    const existing = found.get(name.toLowerCase());
    if (existing) {
      if (existing.percent === null && percent !== null) existing.percent = percent;
      return;
    }

    found.set(name.toLowerCase(), { name, percent });
  };

  /* ---- 1. Course panels (Assignments view) --------------------------------
     Each course is a heading followed by its average somewhere in the same
     block: <a class="sg-header-heading">1234 - US History</a> … 88.62%

     Anchored on the heading element itself rather than on the container's class
     attribute. Starting from `class="…sg-header…"` and scanning forward for the
     next `>` matched the whitespace immediately after the attribute, so every
     "course name" came back blank and the whole pass silently found nothing. */
  /*
   * The name is taken from an anchor specifically, and only another *anchor*
   * ends the block. Allowing any heading-classed element to both name a course
   * and terminate the search meant the grade span ended the block it contained
   * the grade for — so every course parsed with a null percent.
   */
  const headingPattern =
    /<a[^>]*class="[^"]*sg-header-heading[^"]*"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,800}?)(?=<a[^>]*class="[^"]*sg-header-heading|$)/gi;

  for (const match of html.matchAll(headingPattern)) {
    const name = cleanText(match[1]);
    if (!plausibleCourseName(tidyCourseName(name))) continue;

    // A percent sign is the reliable marker inside a panel; a bare number here
    // is as likely to be a period or a room.
    const percent = cleanText(match[2]).match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    add(name, percent ? parsePercent(percent[1]) : null);
  }

  /* ---- 2. Table rows ------------------------------------------------------ */
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        cleanText(cell[1]),
      ),
    );

    /*
     * Find the grade column from the header.
     *
     * Without this, "the first cell after the name containing a digit" picks up
     * the *period* — every course came back with a grade of 3, 4 or 6. The
     * header is the only thing on the page that says which column is which.
     */
    const header = rows.find((cells) =>
      cells.some((cell) => /^(course|class)$/i.test(cell)),
    );
    const gradeColumn =
      header?.findIndex((cell) =>
        /average|grade|percent|mark|score/i.test(cell),
      ) ?? -1;

    for (const cells of rows) {
      if (cells === header || cells.length < 2) continue;

      const nameIndex = cells.findIndex((cell) =>
        plausibleCourseName(tidyCourseName(cell)),
      );
      if (nameIndex === -1) continue;

      let percent: number | null = null;

      if (gradeColumn > -1 && cells[gradeColumn] !== undefined) {
        percent = parsePercent(cells[gradeColumn]);
      } else {
        /*
         * No usable header. Prefer a cell that *looks* like a mark — one with a
         * percent sign or a decimal — over a bare integer, which is far more
         * likely to be a period, a room or a credit count.
         */
        const candidate = cells
          .slice(nameIndex + 1)
          .find((cell) => /%/.test(cell) || /\d+\.\d+/.test(cell));

        percent = candidate ? parsePercent(candidate) : null;
      }

      add(cells[nameIndex], percent);
    }
  }

  return [...found.values()];
}

/**
 * Did we land on a logged-in page at all?
 *
 * A failed HAC login returns HTTP 200 with the login form again, so "the fetch
 * worked" says nothing. Without this check a wrong password looks exactly like
 * a class list of zero, and the student is told they have no courses.
 */
export function looksLikeLoginPage(html: string): boolean {
  return (
    /name="LogOnDetails\.Password"/i.test(html) ||
    /id="LogOnDetails_Password"/i.test(html) ||
    /<form[^>]+action="[^"]*\/Account\/LogOn/i.test(html)
  );
}
