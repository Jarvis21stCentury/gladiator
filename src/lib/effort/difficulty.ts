/**
 * The difficulty scale.
 *
 * Deliberately its own module with **no `server-only`**, for the same reason
 * `lib/status.ts` has none: the rating control is a client component, and it
 * needs the labels. `estimate.ts` imports prisma and is server-only, so a client
 * component importing the scale from there drags the database into the browser
 * bundle — which the bundler rejects, and rightly.
 *
 * ## Why these numbers
 *
 * Canvas knows a thing's points and its title. It has no idea whether *you*
 * understand the topic, and that is usually the difference between a 20-minute
 * problem set and a 90-minute one. This is the only signal in the system for
 * that, and it comes from the one person who actually knows.
 *
 * Asymmetric and gentle on purpose: "brutal" nearly doubles an estimate,
 * "trivial" roughly halves it. Bigger multipliers would let a single mis-tap
 * wreck an evening's plan, and this is a judgement made in one second with no
 * clock in front of you.
 *
 * 3 is exactly 1.0 — rating something "normal" must not change anything, or the
 * act of rating would itself be a nudge.
 */

export const DIFFICULTY_FACTOR: Record<number, number> = {
  1: 0.55,
  2: 0.78,
  3: 1,
  4: 1.4,
  5: 1.9,
};

export const DIFFICULTY_LABEL: Record<number, string> = {
  1: "Trivial",
  2: "Easy",
  3: "Normal",
  4: "Hard",
  5: "Brutal",
};

/** 1 for an unrated item — never rated is not the same as "average". */
export function difficultyFactor(
  difficulty: number | null | undefined,
): number {
  if (difficulty == null) return 1;
  return DIFFICULTY_FACTOR[Math.round(difficulty)] ?? 1;
}
