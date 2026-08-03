/**
 * Spaced repetition — SM-2, with the four-button grading everyone actually uses.
 *
 * Pure functions on purpose. Scheduling is the one part of this feature that is
 * genuinely easy to get subtly wrong, and a wrong scheduler is invisible: cards
 * simply come back at unhelpful times for weeks before you notice. Keeping it
 * free of Prisma and of React means it can be reasoned about, and checked,
 * on its own.
 *
 * No "server-only" here — the review screen previews the next interval on each
 * button before you press it, so the client needs this too.
 */

/** 1 again · 2 hard · 3 good · 4 easy. */
export type Rating = 1 | 2 | 3 | 4;

export const RATINGS: { rating: Rating; label: string; key: string }[] = [
  { rating: 1, label: "Again", key: "1" },
  { rating: 2, label: "Hard", key: "2" },
  { rating: 3, label: "Good", key: "3" },
  { rating: 4, label: "Easy", key: "4" },
];

export interface CardState {
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
}

export interface Scheduled extends CardState {
  dueAt: Date;
}

/**
 * Ease bounds. Below about 1.3 a card's interval barely grows and it turns into
 * a card you see forever; above 3 the jumps get so large you've forgotten it by
 * the next showing. Both ends are failure modes, so both are clamped.
 */
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

/** A year out is as good as "known". Beyond that the date is just noise. */
const MAX_INTERVAL_DAYS = 365;

/** First two successful intervals, before ease takes over. */
const FIRST_INTERVAL = 1;
const SECOND_INTERVAL = 6;

const EASE_DELTA: Record<Rating, number> = {
  1: -0.2,
  2: -0.15,
  3: 0,
  4: 0.15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function newCardState(): CardState {
  return { intervalDays: 0, easeFactor: 2.5, repetitions: 0, lapses: 0 };
}

/**
 * What happens to a card when you grade it.
 *
 * `now` is injectable so the review screen and the server agree on the due date
 * for a session that crosses midnight, and so this can be checked at a fixed
 * point in time rather than against the clock.
 */
export function schedule(
  state: CardState,
  rating: Rating,
  now: Date = new Date(),
): Scheduled {
  const easeFactor = clamp(
    state.easeFactor + EASE_DELTA[rating],
    MIN_EASE,
    MAX_EASE,
  );

  // Forgotten. The card goes back to the start of the ladder and comes round
  // again in this same session — not tomorrow, which is the whole point of
  // saying you'd forgotten it.
  if (rating === 1) {
    return {
      intervalDays: 0,
      easeFactor,
      repetitions: 0,
      lapses: state.lapses + 1,
      dueAt: new Date(now),
    };
  }

  const repetitions = state.repetitions + 1;

  let intervalDays: number;

  if (repetitions === 1) {
    // "Easy" on a card you've never passed skips the one-day step: you already
    // know it, and showing it again tomorrow wastes the session.
    intervalDays = rating === 4 ? 4 : FIRST_INTERVAL;
  } else if (repetitions === 2) {
    intervalDays = rating === 2 ? 3 : SECOND_INTERVAL;
  } else {
    const previous = Math.max(1, state.intervalDays);
    // Hard advances the card, but more slowly than its ease would suggest —
    // otherwise "hard" and "good" schedule almost identically and the button
    // stops meaning anything.
    const growth = rating === 2 ? 1.2 : easeFactor;
    intervalDays = previous * growth * (rating === 4 ? 1.3 : 1);
  }

  intervalDays = clamp(Math.round(intervalDays), 1, MAX_INTERVAL_DAYS);

  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + intervalDays);
  // Due at the start of that day, so a card scheduled at 11pm isn't withheld
  // until 11pm the following night.
  dueAt.setHours(0, 0, 0, 0);

  return {
    intervalDays,
    easeFactor,
    repetitions,
    lapses: state.lapses,
    dueAt,
  };
}

/** "10m" / "3d" / "2mo" — the interval preview on each grading button. */
export function intervalLabel(days: number): string {
  if (days <= 0) return "now";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** What each button would do to this card, for the review screen's labels. */
export function previewIntervals(
  state: CardState,
  now: Date = new Date(),
): Record<Rating, string> {
  return {
    1: intervalLabel(schedule(state, 1, now).intervalDays),
    2: intervalLabel(schedule(state, 2, now).intervalDays),
    3: intervalLabel(schedule(state, 3, now).intervalDays),
    4: intervalLabel(schedule(state, 4, now).intervalDays),
  };
}
