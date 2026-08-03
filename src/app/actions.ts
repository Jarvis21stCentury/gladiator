"use server";

import { revalidatePath } from "next/cache";

import { schedule, type Rating } from "@/lib/flashcards/schedule";
import { prisma } from "@/lib/prisma";

/**
 * The two write paths the UI owns directly. Everything else that writes goes
 * through a route handler because a cron job calls it too; these two only ever
 * happen because a person pressed something, so they are server actions.
 *
 * There is no auth check here, and that is the app-wide design decision in
 * ARCHITECTURE.md rather than an omission — single user, no login, no user
 * table. Both actions are scoped to ids that must already exist.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Log actual-vs-estimated time on a finished assignment. This is the input side
 * of the effort calibration engine — every row here makes the next estimate
 * better, so the form deliberately asks for as little as possible.
 */
export async function logEffort(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const actualRaw = String(formData.get("actualMinutes") ?? "").trim();
  const estimatedRaw = String(formData.get("estimatedMinutes") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!assignmentId) {
    return { ok: false, message: "Pick an assignment." };
  }

  const actualMinutes = Number(actualRaw);

  if (!Number.isFinite(actualMinutes) || actualMinutes <= 0) {
    return { ok: false, message: "How many minutes did it actually take?" };
  }

  if (actualMinutes > 1440) {
    return { ok: false, message: "That's more than a day — check the number." };
  }

  const estimatedMinutes = estimatedRaw ? Number(estimatedRaw) : null;

  if (
    estimatedMinutes !== null &&
    (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0)
  ) {
    return { ok: false, message: "The estimate has to be a positive number." };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, title: true },
  });

  if (!assignment) {
    return { ok: false, message: "That assignment no longer exists." };
  }

  await prisma.effortLog.create({
    data: {
      assignmentId: assignment.id,
      actualMinutes: Math.round(actualMinutes),
      estimatedMinutes:
        estimatedMinutes === null ? null : Math.round(estimatedMinutes),
      note: note || null,
    },
  });

  // The planner and the heat map both read effort history, so both go stale.
  revalidatePath("/classes");
  revalidatePath("/");

  return {
    ok: true,
    message: `Logged ${Math.round(actualMinutes)} min on "${assignment.title}".`,
  };
}

/** Check a task off today's plan. */
export async function togglePlanTask(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return;

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    select: { id: true, done: true },
  });

  if (!task) return;

  await prisma.planTask.update({
    where: { id: task.id },
    data: { done: !task.done },
  });

  revalidatePath("/");
}

/**
 * Answer one card.
 *
 * A server action rather than a route handler for the same reason as the two
 * above: this only ever happens because a person pressed something. It is also
 * the hot path of the whole feature — a review session calls it once per card,
 * a few seconds apart — so it does exactly two writes and returns nothing the
 * client has to wait on to draw the next card.
 */
export async function gradeFlashcard(
  cardId: string,
  rating: Rating,
  elapsedMs?: number,
): Promise<{ ok: boolean; intervalDays: number }> {
  const card = await prisma.flashcard.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      intervalDays: true,
      easeFactor: true,
      repetitions: true,
      lapses: true,
    },
  });

  if (!card) return { ok: false, intervalDays: 0 };

  const next = schedule(card, rating);

  await prisma.$transaction([
    prisma.flashcard.update({
      where: { id: card.id },
      data: {
        dueAt: next.dueAt,
        intervalDays: next.intervalDays,
        easeFactor: next.easeFactor,
        repetitions: next.repetitions,
        lapses: next.lapses,
        lastReviewedAt: new Date(),
      },
    }),
    prisma.flashcardReview.create({
      data: {
        flashcardId: card.id,
        rating,
        intervalDays: next.intervalDays,
        elapsedMs: elapsedMs ?? null,
      },
    }),
  ]);

  // The due counts on the review index and the class dossier are now stale.
  revalidatePath("/review");
  revalidatePath("/classes");

  return { ok: true, intervalDays: next.intervalDays };
}
