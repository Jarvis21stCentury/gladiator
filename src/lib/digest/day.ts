import "server-only";

/**
 * Normalise a *moment* to the school day it belongs to: midnight UTC, matching
 * the `@db.Date` columns on DigestSource and LessonNote.
 *
 * Uses the server's local calendar date, the same convention as the dashboard
 * and daily plan — so the same timezone caveat applies until one is pinned down.
 *
 * ⚠️ Call this exactly once, at the edge (a request handler, or a default
 * argument). It is NOT idempotent: applied to a value it already returned,
 * midnight UTC reads as the previous local day in any timezone west of UTC and
 * the day slips backwards. Functions downstream take an already-normalised day
 * and must not re-normalise it.
 */
export function schoolDay(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
}

/** Parse a `YYYY-MM-DD` query param, falling back to today. */
export function parseSchoolDay(value: string | null): Date {
  if (!value) return schoolDay();

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return schoolDay();

  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

/** `YYYY-MM-DD` for links and form values. */
export function formatSchoolDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
