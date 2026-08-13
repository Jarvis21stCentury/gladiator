/**
 * A class percentage, said the other way a school says it.
 *
 * A student looking at 87% wants to know what that does to their GPA, and doing
 * that arithmetic in your head every time is exactly the sort of thing a tool
 * should have already done.
 *
 * ## Read this before trusting the weighted number
 *
 * There is no single correct table here. Grade-point scales are set per district
 * and sometimes per campus: some use whole letters, some use plus/minus, and the
 * bonus for an AP or honours class varies. Two things follow, and they shape the
 * whole module:
 *
 *   1. **The unweighted 4.0 scale is the number that leads.** Whole letters on a
 *      standard 4.0 scale is the one convention that is the same nearly
 *      everywhere, so it is the figure the page prints large.
 *   2. **The weighted number is always labelled with the assumption it rests
 *      on.** It is shown as "+1.0 AP", never silently folded into one figure, so
 *      a wrong bonus is visible rather than baked into a number the student
 *      might quote to a counsellor.
 *
 * If this district's scale differs, `BANDS` and `RIGOR` below are the only two
 * things to change, and both are ordinary data.
 *
 * Pure — no `server-only`, no Prisma. The Classes page renders it, and a client
 * component may want it later.
 */

export interface GradeBand {
  /** Lowest percentage that earns this band. */
  floor: number;
  letter: string;
  points: number;
}

/**
 * Whole letters on a 4.0 scale.
 *
 * Deliberately not plus/minus. A plus/minus table (A− = 3.7 and so on) is more
 * precise about a convention this app cannot verify, and being precisely wrong
 * about someone's GPA is worse than being roughly right.
 */
const BANDS: GradeBand[] = [
  { floor: 90, letter: "A", points: 4 },
  { floor: 80, letter: "B", points: 3 },
  { floor: 70, letter: "C", points: 2 },
  { floor: 60, letter: "D", points: 1 },
  { floor: 0, letter: "F", points: 0 },
];

export interface RigorTier {
  /** How the tier is named on screen. */
  label: string;
  /** Added to the unweighted points on a weighted scale. */
  bonus: number;
  /** Matched against the course name. */
  pattern: RegExp;
}

/**
 * Course rigor, read off the class name.
 *
 * The name is all there is: neither Canvas nor HAC reports a course's weight.
 * Ordered most-specific first, because "AP Seminar" must match AP rather than
 * falling through to something looser, and the first match wins.
 *
 * `\b` on both ends of AP matters — without it "AP" matches inside "Capstone"
 * and a regular class silently gains a point.
 */
const RIGOR: RigorTier[] = [
  { label: "AP", bonus: 1, pattern: /\bAP\b|\bIB\b|\bAdvanced Placement\b/i },
  {
    label: "Advanced",
    bonus: 0.5,
    pattern: /\bAdv\b|\bAdvanced\b|\bHonors\b|\bHonours\b|\bPre-?AP\b|\bGT\b/i,
  },
];

export interface GpaReading {
  letter: string;
  /** Points on a standard unweighted 4.0 scale. */
  points: number;
  /** The rigor tier detected from the name, when there is one. */
  rigor: RigorTier | null;
  /** `points` plus the rigor bonus. Equal to `points` for a regular class. */
  weightedPoints: number;
}

/** The band a percentage falls in. Percentages above 100 are still an A. */
export function bandFor(percent: number): GradeBand {
  return BANDS.find((band) => percent >= band.floor) ?? BANDS[BANDS.length - 1];
}

export function rigorFor(courseName: string): RigorTier | null {
  return RIGOR.find((tier) => tier.pattern.test(courseName)) ?? null;
}

/**
 * A percentage as a letter and grade points.
 *
 * Null in, null out — a class with no posted average has no GPA contribution,
 * and inventing a 0.0 for it would be a lie with consequences.
 */
export function gpaFor(
  percent: number | null,
  courseName: string,
): GpaReading | null {
  if (percent === null) return null;

  const band = bandFor(percent);
  const rigor = rigorFor(courseName);

  return {
    letter: band.letter,
    points: band.points,
    rigor,
    // An F earns no bonus anywhere: a failed AP class is not worth more than a
    // failed regular one, and every scale that weights at all agrees on that.
    weightedPoints: band.points === 0 ? 0 : band.points + (rigor?.bonus ?? 0),
  };
}

/** `4.0`, `3.5` — one decimal, which is how a GPA is always spoken. */
export function formatPoints(points: number): string {
  return points.toFixed(1);
}
