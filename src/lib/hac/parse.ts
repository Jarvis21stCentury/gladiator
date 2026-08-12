/**
 * Reading a Home Access Center page.
 *
 * Pure string work, no `server-only`, no network — which is what let this be
 * fixed against a real saved page without touching login, cookies or storage.
 *
 * ## What the page actually looks like
 *
 * The Assignments view is a list of *class blocks*. Each block is a
 * `div.AssignmentClass` whose header anchor carries the class name, and inside
 * it is a table of that class's assignments:
 *
 *     Date Due | Date Assigned | Assignment | Category | Score | Total Points
 *
 * That structure is the whole reason the first version produced nonsense. It
 * scanned every `<table>` on the page for course-shaped rows, so each
 * *assignment* became a course: "Unit 1 Vocabulary", "Clicker Game Challenge",
 * even the header cell "Date Due" — 28 invented classes, each with a grade of
 * 1 scraped out of a points column. Courses now come from class headers only,
 * and tables are only ever read as assignments.
 */

export interface HacAssignment {
  title: string;
  dueAt: Date | null;
  category: string | null;
  /** Points earned, when the work has been marked. */
  score: number | null;
  pointsPossible: number | null;
}

export interface HacCourse {
  /** Cleaned for display and for matching: "Entrepreneurship". */
  name: string;
  /** Exactly as HAC prints it: "CATE34400A - 2 Entrepreneurship S1". */
  rawName: string;
  /** The class period, when the name carries one. */
  period: number | null;
  /** The posted average, when HAC is showing one. */
  percent: number | null;
  assignments: HacAssignment[];
}

/** Collapse tags, entities and whitespace so comparisons are about words. */
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

export interface TidyCourse {
  name: string;
  period: number | null;
}

/**
 * Turn "CATE34400A - 2 Entrepreneurship S1" into "Entrepreneurship", period 2.
 *
 * Three layers of district bookkeeping wrap the actual class name, and all
 * three have to go or the same class read from HAC and from Canvas will never
 * match:
 *
 *   CATE34400A   the district course code
 *   2            the period
 *   S1           the semester
 *
 * The semester suffix matters more than it looks. HAC lists "…S1" and "…S2" as
 * separate classes for the same subject all year, so keeping it would give a
 * student two Entrepreneurship classes, one of which is always empty.
 */
export function tidyCourseName(raw: string): TidyCourse {
  let text = cleanText(raw);

  // Leading course code: an alphanumeric token containing a digit, then a
  // separator. "Algebra 2 - Honors" is untouched because the token before the
  // dash contains a space.
  text = text.replace(/^(?=[A-Z0-9]*\d)[A-Z0-9]{2,12}\s*[-–—:]\s*/i, "");

  // Leading period number: a bare 1–2 digit number followed by a space.
  let period: number | null = null;
  const periodMatch = text.match(/^(\d{1,2})\s+(?=\S)/);
  if (periodMatch) {
    period = Number(periodMatch[1]);
    text = text.slice(periodMatch[0].length);
  }

  // Trailing semester/term marker.
  text = text.replace(/\s+(S[12]|SEM\s*[12]|Q[1-4]|YR)\s*$/i, "");

  return { name: text.trim(), period };
}

/** A percent from "93.5", "93.5%", or "A (93.5)". Null when there is no number. */
export function parsePercent(raw: string): number | null {
  const text = cleanText(raw);
  const match = text.match(/(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 150) return null;

  return value;
}

/** "09/30/2026" → a local Date at midnight. */
function parseDueDate(raw: string): Date | null {
  const match = cleanText(raw).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;

  const [, month, day, year] = match.map(Number);
  const date = new Date(year, month - 1, day, 23, 59);

  return Number.isNaN(date.getTime()) ? null : date;
}

function cells(row: string): string[] {
  return [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
    cleanText(cell[1]),
  );
}

/**
 * Assignments inside one class block.
 *
 * Columns are located by their headers rather than by position, because the set
 * of columns differs between districts and a fixed index silently reads the
 * wrong one — which is how a "Total Points" of 1 became a grade of 1%.
 */
function parseAssignments(block: string): HacAssignment[] {
  const found: HacAssignment[] = [];

  for (const table of block.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(
      (row) => cells(row[1]),
    );
    if (rows.length < 2) continue;

    const header = rows[0].map((cell) => cell.toLowerCase());
    const index = (...names: string[]) =>
      header.findIndex((cell) => names.some((name) => cell.includes(name)));

    const titleAt = index("assignment");
    // Not an assignments table — leave it alone rather than guessing.
    if (titleAt === -1) continue;

    const dueAt = index("date due", "due date");
    const categoryAt = index("category");
    const scoreAt = index("score");
    const totalAt = index("total points", "points");

    for (const row of rows.slice(1)) {
      const title = row[titleAt]?.replace(/\s*\*\s*$/, "").trim();
      if (!title) continue;

      found.push({
        title,
        dueAt: dueAt > -1 ? parseDueDate(row[dueAt] ?? "") : null,
        category: categoryAt > -1 ? row[categoryAt] || null : null,
        score: scoreAt > -1 ? parsePercent(row[scoreAt] ?? "") : null,
        pointsPossible: totalAt > -1 ? parsePercent(row[totalAt] ?? "") : null,
      });
    }
  }

  return found;
}

/**
 * Every class on the page, with its assignments.
 *
 * Anchored on `div.AssignmentClass`, which is the only element that means "a
 * class starts here". Nothing else on the page is treated as a course.
 */
export function parseHacGrades(html: string): HacCourse[] {
  const courses: HacCourse[] = [];
  const seen = new Set<string>();

  const blocks = html.split(/(?=<div[^>]*class="[^"]*AssignmentClass)/i).slice(1);

  for (const block of blocks) {
    const anchor = block.match(
      /class="sg-header-heading"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!anchor) continue;

    const rawName = cleanText(anchor[1]);
    const { name, period } = tidyCourseName(rawName);
    if (!name || name.length < 2) continue;

    // The S1/S2 split means the same subject can appear twice; keep the first.
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    /*
     * The average lives in the right-hand header span. It is blank whenever the
     * Report Card Run is "(All Runs)" — HAC refuses to compute one — and also
     * whenever nothing has actually been marked yet, which is the normal state
     * at the start of a term. A blank average is not an error and must not be
     * written as a zero.
     */
    const right = block.match(
      /class="sg-header-heading sg-right"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const percentText = right ? cleanText(right[1]) : "";
    const percent = /\d/.test(percentText) ? parsePercent(percentText) : null;

    courses.push({
      name,
      rawName,
      period,
      percent,
      assignments: parseAssignments(block),
    });
  }

  return courses;
}

/**
 * Did we land on a logged-in page at all?
 *
 * A failed HAC login returns HTTP 200 with the login form again, so "the fetch
 * worked" says nothing.
 */
export function looksLikeLoginPage(html: string): boolean {
  return (
    /name="LogOnDetails\.Password"/i.test(html) ||
    /id="LogOnDetails_Password"/i.test(html) ||
    /<form[^>]+action="[^"]*\/Account\/LogOn/i.test(html)
  );
}
