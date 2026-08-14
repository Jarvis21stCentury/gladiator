/**
 * The teacher's daily page.
 *
 * Most teachers here keep one Canvas page — usually called "Coursework" — that
 * says what the class is doing today and what is due. It is the single best
 * source in Canvas for a nightly digest, and the module scanner could never see
 * it, for two separate reasons:
 *
 *   1. **It is usually not in a module.** It is pinned to the course nav, so a
 *      walk of modules and their items never reaches it.
 *   2. **It is one page rewritten every day.** The module scanner keys on item
 *      id and skips anything already recorded, so even when the page *was* in a
 *      module it was read once — in August — and never looked at again.
 *
 * So this module identifies the page by title, and identifies its *content* by
 * hash, which is the only definition of "new" that survives a page that keeps
 * the same id forever.
 *
 * Pure: matching, slicing and hashing only. No Prisma, no network, no
 * `server-only` — which is what lets the day-slicing be tested against real
 * page markup without a Canvas token.
 */

import { createHash } from "node:crypto";

/**
 * Page titles worth reading, best first.
 *
 * Ordered, and the order is the whole point: a course with both "Coursework"
 * and "Daily Agenda" should get the one the student actually named. Everything
 * after the first two is a common synonym seen on the same kind of page, and
 * this list is the one place to add a teacher who calls it something else.
 *
 * Matching is on normalised titles (lowercased, punctuation and spaces
 * stripped), so "Course Work", "coursework!" and "COURSE-WORK" are all one
 * thing.
 */
const TITLE_PATTERNS: string[] = [
  "coursework",
  "classwork",
  "dailyagenda",
  "dailywork",
  "agenda",
  "todayinclass",
  "whatwedidtoday",
  "lessonplan",
  "weeklyagenda",
  "weekataglance",
  /*
   * Week- and quarter-shaped titles. Not guesses: these are the real page names
   * in this student's courses — "Q1 | Week 1", "Quarter 1 I Week 1", "Unit 1
   * Overview" — and they are the daily-coursework page under another name. The
   * matcher is a contains-check on the normalised title, so "q1week1" is caught
   * by "week" here.
   */
  "week",
  "quarter",
  // "Unit 1 Overview" normalises to "unit1overview", so the pattern has to be
  // the bare word — the digit sits between the two halves.
  "overview",
  "calendar",
  // A unit page is the coursework page in a class that organises by unit —
  // Chemistry's "Unit 1: Safety, Equipment, and Calculations" is a day-by-day
  // calendar of topics. Last in the list, so a page actually named
  // "Coursework" always wins over it.
  "unit",
];

/**
 * Titles that name an *index* of coursework rather than coursework.
 *
 * "Advanced Chemistry Unit List" matches "unit" exactly as well as "Unit 1:
 * Safety, Equipment, and Calculations" does, and it is six hundred characters
 * of links. Picking it would hand the digest a table of contents every night.
 */
const INDEX_TITLES = ["list", "index", "home", "teacherinformation", "resources"];

/** Lowercase, drop everything that isn't a letter or digit. */
function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface PageLike {
  url: string;
  title: string;
  updated_at?: string | null;
}

/**
 * The best coursework-ish page in a course, or null.
 *
 * Exact normalised matches beat contains-matches, and an earlier pattern beats
 * a later one — so a page literally called "Coursework" always wins over
 * "Weekly Agenda 2026", and both win over nothing.
 */
export function findCourseworkPage<T extends PageLike>(pages: T[]): T | null {
  return rankCourseworkPages(pages)[0] ?? null;
}

/**
 * Every candidate, best title first.
 *
 * Plural because one title is not enough to choose between "Unit 1", "Unit 2"
 * and "Unit 3": they rank identically, so the first one found would stay the
 * course's coursework page for the whole year while the class moved on without
 * it. The caller fetches these in order and keeps the one whose content
 * actually covers today — see the ingest.
 */
export function rankCourseworkPages<T extends PageLike>(pages: T[]): T[] {
  const scored: { page: T; rank: number }[] = [];

  for (const page of pages) {
    const title = normaliseTitle(page.title ?? "");
    if (!title) continue;
    if (INDEX_TITLES.some((word) => title.includes(word))) continue;

    for (let index = 0; index < TITLE_PATTERNS.length; index += 1) {
      const pattern = TITLE_PATTERNS[index];

      // Exact matches rank ahead of every contains-match, hence the doubling.
      const rank =
        title === pattern
          ? index
          : title.includes(pattern)
            ? index + TITLE_PATTERNS.length
            : -1;

      if (rank === -1) continue;
      scored.push({ page, rank });
      break;
    }
  }

  return scored.sort((a, b) => a.rank - b.rank).map((entry) => entry.page);
}

/**
 * Ways a teacher writes today's date on a page.
 *
 * Generated per-day rather than matched with one loose regex, because the loose
 * version matched *any* date and would happily slice out last Tuesday. These
 * are anchored to the specific day being asked for.
 */
function dateNeedles(day: Date): RegExp[] {
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth() + 1;
  const date = day.getUTCDate();

  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const name = monthNames[month - 1];
  const abbreviation = name.slice(0, 3);

  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    // 8/13, 08/13, 8-13, 8/13/26, 8/13/2026 — the common American shorthand.
    new RegExp(`\\b0?${month}\\s*[/\\-.]\\s*0?${date}(\\s*[/\\-.]\\s*(20)?${String(year).slice(2)})?\\b`),
    // August 13, Aug 13, Aug. 13th
    new RegExp(`\\b(${name}|${abbreviation})\\.?\\s+0?${date}(st|nd|rd|th)?\\b`, "i"),
    // 13 August
    new RegExp(`\\b0?${date}(st|nd|rd|th)?\\s+(${name}|${abbreviation})\\b`, "i"),
    // ISO
    new RegExp(`\\b${year}-${pad(month)}-${pad(date)}\\b`),
  ];
}

/** Does this line name the given day? */
export function lineMentionsDay(line: string, day: Date): boolean {
  const text = line.toLowerCase();
  return dateNeedles(day).some((needle) => needle.test(text));
}

const WEEKDAY = "(?:mon|tues|tue|wednes|wed|thurs|thur|thu|fri|satur|sat|sun)(?:day)?";
const MONTH_NAME =
  "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)";

/**
 * A line that *starts* a new day's section.
 *
 * Anchored to the start of the line, and that anchoring is the whole design.
 * The first version asked only whether a date appeared anywhere in a short
 * line, which meant "Worked examples 1-8 on the board" and "problems 1-20"
 * both read as dated headings — so today's section ended on its first bullet,
 * came out to fourteen characters, and the whole page got sent to the model
 * instead. A heading is a line that *is* a date, optionally introduced by a
 * weekday; a sentence that happens to mention one is not.
 *
 * `-` is deliberately not a separator here. Teachers write "8/13" far more
 * often than "8-13", and a hyphen is how every number range on the page is
 * written.
 */
function looksLikeDatedHeading(line: string): boolean {
  // Leading list markers and decoration are not part of the heading.
  const text = line
    .trim()
    .toLowerCase()
    .replace(/^[•*\-–—\s>|#]+/, "")
    .trim();

  if (text.length === 0 || text.length > 90) return false;

  const patterns = [
    // "Thursday 8/13", "Thu 8/13/26", "8/13"
    new RegExp(`^(${WEEKDAY}\\b[\\s,:–—-]*)?\\d{1,2}\\s*[/.]\\s*\\d{1,2}\\b`),
    // "Thursday August 13", "August 13", "Aug. 13th"
    new RegExp(`^(${WEEKDAY}\\b[\\s,:–—-]*)?${MONTH_NAME}\\.?\\s+\\d{1,2}(st|nd|rd|th)?\\b`),
    // "13 August"
    new RegExp(`^(${WEEKDAY}\\b[\\s,:–—-]*)?\\d{1,2}(st|nd|rd|th)?\\s+${MONTH_NAME}\\b`),
    // ISO
    /^\d{4}-\d{2}-\d{2}\b/,
    // A bare weekday on its own line, which is how a week-at-a-glance page is
    // usually laid out. Only when the line is *just* that.
    new RegExp(`^${WEEKDAY}\\b[\\s,:–—-]*$`),
  ];

  return patterns.some((pattern) => pattern.test(text));
}

export interface DaySlice {
  /** Empty when the page is dated but has nothing for this day — see `sliceDay`. */
  text: string;
  /** True when a heading for this specific day was found and sliced out. */
  dated: boolean;
}

/**
 * Today's part of a page that covers many days.
 *
 * A coursework page is usually a running log: a dated heading, that day's work,
 * then the next dated heading. Handing the whole page to the model every night
 * would produce a digest of the entire term, so this cuts out the section under
 * today's heading and stops at the next dated one.
 *
 * The two no-match cases are opposite and it matters which is which:
 *
 *   - **The page has no dated headings at all.** It is a single-day page that
 *     gets overwritten — plenty of teachers keep one — so the whole body is
 *     today's work. Returned with `dated: false`.
 *   - **The page has dated headings but none for today.** The teacher has not
 *     posted yet. Returns empty, and the caller ingests nothing. Returning the
 *     page here is the tempting mistake and it is badly wrong: every night's
 *     digest would re-summarise the entire term to date.
 */
export function sliceDay(text: string, day: Date): DaySlice {
  const lines = text.split("\n");

  /*
   * A heading naming today beats any other mention of it. Without that
   * preference the slice could start on a bullet inside *yesterday's* section
   * that happens to say "due 8/13", and take yesterday's work with it.
   */
  let start = lines.findIndex(
    (line) => looksLikeDatedHeading(line) && lineMentionsDay(line, day),
  );
  if (start === -1) {
    start = lines.findIndex((line) => lineMentionsDay(line, day));
  }

  if (start === -1) {
    const dividedByDay = lines.some((line) => looksLikeDatedHeading(line));
    return { text: dividedByDay ? "" : text.trim(), dated: false };
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lineMentionsDay(lines[index], day)) continue;
    if (looksLikeDatedHeading(lines[index])) {
      end = index;
      break;
    }
  }

  const slice = lines.slice(start, end).join("\n").trim();

  // A heading with nothing under it is not a day's work; fall back rather than
  // hand the model a single line and ask for study notes.
  return slice.length > 40
    ? { text: slice, dated: true }
    : { text: text.trim(), dated: false };
}

/**
 * A stable id for one *version* of a page.
 *
 * This is the crux. Canvas gives a coursework page the same url forever, so
 * keying digest sources on the url means reading it once and never again.
 * Keying on url + content hash means it is re-read exactly when the teacher
 * changes it, and re-running the ingest five times in an evening still produces
 * one source.
 */
export function courseworkExternalId(pageUrl: string, text: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `canvas-coursework-${pageUrl}-${hash}`;
}
