/**
 * Deciding whether two course names are the same class.
 *
 * Canvas and HAC have no shared identifier — they are separate systems that
 * happen to describe the same eight classes — so a name is the only thing to
 * match on, and each dresses it up differently:
 *
 *   Canvas   "AP Pre Calculus YR (GIPSON, HANNAH)"
 *   HAC      "MTH34300A - 3 AP Pre Calculus S1"
 *
 * Without normalising both, every class in the product appears twice: once from
 * each source, each with half the information. That is exactly what happened —
 * eight Canvas classes and eight HAC duplicates sitting side by side.
 *
 * Pure functions over strings, deliberately shared rather than duplicated in
 * each sync, so the two sides can never drift into disagreeing about what
 * counts as the same class.
 */

/**
 * Reduce a course name to the part that identifies the subject.
 *
 * Strips, in order: a leading district course code, a leading period number, a
 * trailing teacher parenthetical, and term markers (YR, S1, Q3) wherever they
 * appear. What survives is lowercased and stripped of punctuation, because
 * "GT HumanitiesI/Eng 1 Adv" and "GT Humanities 2/AP World" differ in ways that
 * matter while "AP Pre-Calculus" and "AP Pre Calculus" do not.
 */
/*
 * When name matching cannot work, and what to do instead.
 *
 * Some classes are named so differently in the two systems that no normalising
 * will ever join them: HAC calls one "GT Humanities 2/AP World" and Canvas
 * calls the same class "GT HumanitiesI/Eng 1 Adv YR (MOTLEY, KYLE)". Different
 * subject words, different numeral, different teacher convention. Loosening the
 * matcher enough to catch that would start merging genuinely different classes,
 * which is far worse — a merged pair silently pools two courses' grades.
 *
 * So the escape hatch is to link them by hand: put the Canvas id on the
 * HAC-named Course row and delete the duplicate. That is durable without any
 * further special-casing, because the Canvas sync upserts on `canvasId` and
 * therefore lands on the row it has been given, and the HAC sync matches the
 * name it already knows. Both syncs then feed one class.
 */
export function normaliseCourseName(raw: string): string {
  let text = raw.trim();

  // Trailing teacher: "… (GIPSON, HANNAH)".
  text = text.replace(/\s*\([^)]*\)\s*$/, "");

  // Leading district code: an alphanumeric token containing a digit.
  text = text.replace(/^(?=[A-Z0-9]*\d)[A-Z0-9]{2,12}\s*[-–—:]\s*/i, "");

  // Leading period number.
  text = text.replace(/^\d{1,2}\s+(?=\S)/, "");

  // Term markers, anywhere.
  text = text.replace(/\b(YR|S[12]|SEM\s*[12]|Q[1-4])\b/gi, " ");

  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whether two course names describe the same class. */
export function sameCourse(a: string, b: string): boolean {
  const left = normaliseCourseName(a);
  const right = normaliseCourseName(b);
  if (!left || !right) return false;
  if (left === right) return true;

  /*
   * One side being a prefix of the other covers the common real case where a
   * source appends something the other omits — "chemistry adv" against
   * "chemistry adv honors". Guarded by a length floor so short names like
   * "art" do not swallow "art history".
   */
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;

  return shorter.length >= 8 && longer.startsWith(`${shorter} `);
}
