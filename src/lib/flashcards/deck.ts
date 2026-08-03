import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * What the review screens read.
 *
 * A "deck" is just one class's cards; there is no deck table, because a
 * single-user tool that already has a Course model does not need a second way
 * to group things by class.
 */

/** Cards handed to one session. Enough for a real sitting, not an endless one. */
export const SESSION_LIMIT = 40;

export interface DeckSummary {
  courseId: string;
  courseName: string;
  /** Cards whose time has come, including ones never seen. */
  due: number;
  /** Never reviewed. Counted separately because a wall of new cards is a slog. */
  fresh: number;
  total: number;
  /** When the next card comes up, if none are due now. */
  nextDueAt: Date | null;
  /** Notes that exist for this class but have no cards yet. */
  uncardedNotes: number;
}

export interface ReviewCard {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  /** True when this card has never been answered. */
  fresh: boolean;
}

export async function getDeckSummaries(): Promise<DeckSummary[]> {
  const now = new Date();

  const courses = await prisma.course.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { flashcards: true } },
    },
  });

  // Three cheap grouped counts beat one query per class, and this runs on the
  // review index where every class is on screen at once.
  const [dueGroups, freshGroups, uncardedNotes, nextDue] = await Promise.all([
    prisma.flashcard.groupBy({
      by: ["courseId"],
      where: { suspended: false, dueAt: { lte: now } },
      _count: { _all: true },
    }),
    prisma.flashcard.groupBy({
      by: ["courseId"],
      where: { suspended: false, lastReviewedAt: null },
      _count: { _all: true },
    }),
    prisma.lessonNote.findMany({
      where: { flashcards: { none: {} } },
      select: { courseId: true },
    }),
    prisma.flashcard.groupBy({
      by: ["courseId"],
      where: { suspended: false, dueAt: { gt: now } },
      _min: { dueAt: true },
    }),
  ]);

  const dueBy = new Map(dueGroups.map((g) => [g.courseId, g._count._all]));
  const freshBy = new Map(freshGroups.map((g) => [g.courseId, g._count._all]));
  const nextBy = new Map(nextDue.map((g) => [g.courseId, g._min.dueAt]));

  const uncardedBy = new Map<string, number>();
  for (const note of uncardedNotes) {
    uncardedBy.set(note.courseId, (uncardedBy.get(note.courseId) ?? 0) + 1);
  }

  return courses.map((course) => ({
    courseId: course.id,
    courseName: course.name,
    due: dueBy.get(course.id) ?? 0,
    fresh: freshBy.get(course.id) ?? 0,
    total: course._count.flashcards,
    nextDueAt: nextBy.get(course.id) ?? null,
    uncardedNotes: uncardedBy.get(course.id) ?? 0,
  }));
}

export async function getDeckSummary(
  courseId: string,
): Promise<DeckSummary | null> {
  const all = await getDeckSummaries();
  return all.find((deck) => deck.courseId === courseId) ?? null;
}

/**
 * The queue for one sitting.
 *
 * Oldest-due first, so the cards you are furthest behind on come back before
 * the ones that only just came up. New cards sort last within that, so a
 * session opens with material you have actually seen before.
 */
export async function getDueCards(
  courseId: string,
  limit = SESSION_LIMIT,
): Promise<ReviewCard[]> {
  const cards = await prisma.flashcard.findMany({
    where: { courseId, suspended: false, dueAt: { lte: new Date() } },
    orderBy: [{ lastReviewedAt: { sort: "desc", nulls: "last" } }, { dueAt: "asc" }],
    take: limit,
    select: {
      id: true,
      front: true,
      back: true,
      hint: true,
      intervalDays: true,
      easeFactor: true,
      repetitions: true,
      lapses: true,
      lastReviewedAt: true,
    },
  });

  return cards.map(({ lastReviewedAt, ...card }) => ({
    ...card,
    fresh: lastReviewedAt === null,
  }));
}

/** Every card in a class, for reading the deck rather than reviewing it. */
export async function getDeckCards(courseId: string) {
  return prisma.flashcard.findMany({
    where: { courseId },
    orderBy: [{ dueAt: "asc" }],
    select: {
      id: true,
      front: true,
      back: true,
      hint: true,
      dueAt: true,
      intervalDays: true,
      repetitions: true,
      lapses: true,
      suspended: true,
      lessonNote: { select: { date: true } },
    },
  });
}
