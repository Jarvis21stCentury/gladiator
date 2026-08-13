/**
 * The decisions made about work read off a teacher's coursework page.
 *
 * Pure, and in its own file for the reason this codebase has now learned twice:
 * `coursework-tasks.ts` is `server-only`, so anything sitting beside the model
 * call and the Prisma writes cannot be run — or tested — without both. Every
 * rule in here is one that can be quietly wrong (deduplication, date
 * validation, the per-day cap), and this deployment has no LLM key configured,
 * so a pure function is the only way any of it gets exercised before it meets
 * real homework.
 */

/** A page's worth of homework. More than this and the model has misread. */
const MAX_TASKS_PER_DAY = 8;

/** One item the model returned, before anything has been decided about it. */
export interface ExtractedItem {
  title: string;
  dueDate: string;
}

export interface PlannedTask {
  title: string;
  dueAt: Date;
}

export interface TaskPlan {
  create: PlannedTask[];
  skippedExisting: number;
  skippedUndated: number;
}


/** End of the given calendar day, local time — a due date with no clock on it. */
function endOfDay(isoDate: string): Date | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    23,
    59,
    0,
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Words that carry no identity, so two titles are not different for having them.
 *
 * "HW: Practice Set 1.1 (due Monday)" and "Practice Set 1.1" are the same piece
 * of work; the extra words are packaging.
 */
const FILLER = new Set([
  "hw",
  "homework",
  "assignment",
  "assignments",
  "due",
  "worksheet",
  "ws",
  "packet",
  "the",
  "a",
  "an",
  "for",
  "and",
  "of",
  "on",
  "in",
  "your",
  "please",
  "finish",
  "complete",
  "turn",
]);

/**
 * Meaningful words in a title, lowercased, filler and punctuation dropped.
 *
 * A section number stays one token — "1.1" does not become "1" and "1". This is
 * the single most important line in the file. Split, "Practice Set 1.1" and
 * "Practice Set 2.1" share three of three tokens and read as the same
 * assignment, so the second one silently never gets created; likewise "Read
 * section 2.3" and "Read section 3.2". Kept whole, they differ where they
 * should.
 */
export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    // Drop any dot that isn't between two digits: sentence periods go, decimals
    // and section numbers stay.
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .split(" ")
    .filter((word) => word.length > 0 && !FILLER.has(word));
}

/** Kept for callers that want a stable string form of a title. */
export function titleKey(title: string): string {
  return titleTokens(title).join(" ");
}

/**
 * Does one token stand for the other?
 *
 * Prefix matching with a floor of four characters, which is what catches the
 * abbreviation a teacher types and Canvas spells out: vocab/vocabulary,
 * chap/chapter, quiz stays quiz. The floor matters — without it "1" matches
 * "1.1" and every numbered assignment in a class collapses into one.
 */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/**
 * Are these two titles the same piece of work?
 *
 * Exact keys were not enough and the failure was concrete: Canvas has "Unit 1
 * Vocabulary", the coursework page says "unit 1 vocab", the keys differ, and
 * the student gets the same homework twice — in the planner, the forecast and
 * every due list. So this compares meaningful tokens and asks whether the
 * shorter title is essentially contained in the longer one.
 *
 * The threshold is deliberately high. A false match silently drops real
 * homework, which is far worse than a visible duplicate the student can delete.
 */
export function sameTask(a: string, b: string): boolean {
  const left = titleTokens(a);
  const right = titleTokens(b);

  if (left.length === 0 || right.length === 0) return false;

  const [short, long] = left.length <= right.length ? [left, right] : [right, left];

  /*
   * Each token on the right may be spent once.
   *
   * Membership testing was not enough, and the counter-example is a real pair
   * from this student's timetable: "Unit 2 Assessment - Std 1 Math/Lists" and
   * "Unit 2 Assessment - Std 2 Procedures". The "2" in "Std 2" found the "2" in
   * "Unit 2", coverage hit 5 of 6, and one of two genuinely different
   * assessments would never have been created. Bare digits are weak tokens that
   * match promiscuously across positions; spending them fixes it without any
   * special-casing of numbers.
   */
  const spent = new Array<boolean>(long.length).fill(false);
  let covered = 0;

  for (const token of short) {
    const index = long.findIndex(
      (other, position) => !spent[position] && tokenMatches(token, other),
    );

    if (index !== -1) {
      spent[index] = true;
      covered += 1;
    }
  }

  // A single-token title has to match outright; there is no room for partial
  // overlap to mean anything ("Lab" vs "Lab report" are not the same task).
  if (short.length === 1) return covered === 1 && long.length === 1;

  /*
   * Both directions, and the second one is what stops a title being swallowed
   * by a longer one that contains it. "AI Presentation" is fully covered by
   * "AI Presentation Check-in" — and they are two separate assignments in this
   * student's AP Seminar class. Without the reverse test the check-in would
   * never be created, and a piece of homework silently going missing is the one
   * outcome this whole feature cannot afford.
   *
   * The cost is the opposite error: "Practice Set 1.1" and "Practice Set 1.1
   * problems 1-20" are the same work and will now both be created. That is a
   * duplicate the student can see and delete in one click, which is the trade
   * this file makes everywhere — a visible duplicate beats invisible missing
   * work.
   */
  return covered / short.length >= 0.8 && covered / long.length >= 0.75;
}

/**
 * What to create, given what the model said and what the class already has.
 *
 * Split out from the database work on purpose: this is every rule that can be
 * wrong — deduplication, date validation, the cap — and none of it needs a
 * model or a connection to check. That matters here more than usual, because
 * this app currently has no LLM key configured, so the only way any of this
 * gets exercised before it runs against real homework is as a pure function.
 */
export function planCourseworkTasks(
  items: ExtractedItem[],
  existingTitles: string[],
): TaskPlan {
  // Grows as items are accepted, so two phrasings of the same thing on one page
  // don't both land — the model will happily return "Practice Set 1.1" and
  // "practice set 1.1 problems 1-20" from adjacent bullets.
  const known = [...existingTitles];

  const create: PlannedTask[] = [];
  let skippedExisting = 0;
  let skippedUndated = 0;

  for (const item of items.slice(0, MAX_TASKS_PER_DAY)) {
    const title = item.title.trim();
    if (!title) continue;

    const dueAt = endOfDay(item.dueDate);
    if (!dueAt) {
      skippedUndated += 1;
      continue;
    }

    if (
      titleTokens(title).length === 0 ||
      known.some((existing) => sameTask(existing, title))
    ) {
      skippedExisting += 1;
      continue;
    }

    known.push(title);
    create.push({ title, dueAt });
  }

  return { create, skippedExisting, skippedUndated };
}
