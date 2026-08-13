import type { AssignmentSource } from "@/generated/prisma/enums";

/**
 * Which rows the student may tick off or throw away.
 *
 * Pure and shared, because the answer has to be identical in three places — the
 * front page, the class card and the two server actions — and it was previously
 * an inline `=== "MANUAL"` in each. Adding COURSEWORK to a literal in one file
 * and not the others would have produced controls that render and then silently
 * do nothing, which is the worst version of this bug.
 *
 * MANUAL is a task the student wrote. COURSEWORK was read off a teacher's daily
 * page by a model — a guess, and one they must be able to correct. Canvas and
 * HAC own `submitted` on their own rows and would undo any local change on the
 * next sync, so offering the control there would be a lie.
 */
export function isOwnedTask(source: AssignmentSource): boolean {
  return source === "MANUAL" || source === "COURSEWORK";
}

/** Short provenance for a row that didn't come from the student or Canvas. */
export function taskOriginLabel(source: AssignmentSource): string | null {
  return source === "COURSEWORK"
    ? "from coursework page"
    : source === "SYLLABUS"
      ? "from syllabus"
      : null;
}
