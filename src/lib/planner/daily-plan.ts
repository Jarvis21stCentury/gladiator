import "server-only";

import { z } from "zod";

import { EFFORT_SOURCE_LABEL } from "@/lib/effort/estimate";
import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { getPlanInputs, type PlanCandidate, type PlanInputs } from "./gather";

/**
 * The morning daily plan: a prioritised task list plus a short readable summary.
 * Per ARCHITECTURE.md this runs on the strong model — the narrative is one of
 * the few places where writing quality actually matters.
 */

// No `.min()` / `.max()` anywhere: strict structured-output modes reject
// numeric and length constraints. Ranges are enforced after parsing instead.
const PlanTaskSchema = z.strictObject({
  /** Must be an id from the supplied candidates, or null for a task the model adds. */
  assignmentId: z.string().nullable(),
  title: z.string(),
  reason: z.string(),
  estimatedMinutes: z.number(),
});

const PlanSchema = z.strictObject({
  summary: z.string(),
  tasks: z.array(PlanTaskSchema),
});

const SYSTEM_PROMPT = `You plan one student's school day.

You are given every unsubmitted assignment due soon, an effort estimate for each, and the time the student actually has free today. Produce an ordered task list for today only.

Rules:
- Order by what genuinely needs doing first: overdue work, then today's deadlines, then work that must be started early to be finishable.
- Only schedule what fits the available minutes. Leaving good work off today is correct; an unachievable plan is worse than a short one.
- Every task must use the assignmentId of the item it came from. Use null only for a task not tied to a listed assignment.
- Keep estimatedMinutes close to the supplied estimate unless you are splitting a large item into a first session today.
- reason: one short sentence, concrete about why this is placed here. No filler.
- summary: two or three sentences to the student, plain language, no preamble or headers. Say what today is actually about and flag the one thing most likely to go wrong. Do not restate the whole list.`;

function describeCandidate(candidate: PlanCandidate): string {
  const parts = [
    `id=${candidate.assignmentId}`,
    `"${candidate.title}"`,
    `class=${candidate.courseName}`,
  ];

  if (candidate.overdue) {
    parts.push(`OVERDUE by ${Math.abs(candidate.daysUntilDue ?? 0)}d`);
  } else if (candidate.daysUntilDue !== null) {
    parts.push(
      candidate.daysUntilDue === 0
        ? "due TODAY"
        : `due in ${candidate.daysUntilDue}d`,
    );
  }

  if (candidate.pointsPossible !== null) {
    parts.push(`${candidate.pointsPossible}pts`);
  }

  // Say which source the estimate came from — a figure derived from this
  // student's own logged time deserves more weight than a heuristic guess.
  parts.push(
    `est=${candidate.estimatedMinutes}min (${EFFORT_SOURCE_LABEL[candidate.effortSource]})`,
  );

  return `- ${parts.join(", ")}`;
}

function buildPrompt(inputs: PlanInputs): string {
  const dateLabel = inputs.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const windows = inputs.freeWindows
    .map(
      (window) =>
        `- ${window.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${window.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${window.minutes} min)`,
    )
    .join("\n");

  return [
    `Today is ${dateLabel}.`,
    "",
    `Free time today: ${inputs.totalFreeMinutes} minutes total.`,
    windows || "- none",
    inputs.busyTitles.length > 0
      ? `\nAlready committed today: ${inputs.busyTitles.join(", ")}.`
      : "",
    "",
    "Unsubmitted work due soon:",
    inputs.candidates.length > 0
      ? inputs.candidates.map(describeCandidate).join("\n")
      : "- nothing due in the next 10 days",
  ].join("\n");
}

export interface DailyPlanResult {
  planId: string;
  date: Date;
  taskCount: number;
  summary: string;
  provider: string;
  model: string;
  droppedTaskCount: number;
}

/**
 * Generate and store today's plan. Re-running for the same date replaces that
 * day's plan rather than appending a second one.
 */
export async function generateDailyPlan(
  date: Date = new Date(),
): Promise<DailyPlanResult> {
  const inputs = await getPlanInputs(date);

  const result = await generateJson({
    schemaName: "daily_plan",
    schema: PlanSchema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(inputs),
    // ARCHITECTURE.md: the daily-plan narrative gets the stronger model.
    quality: "strong",
    maxOutputTokens: 4000,
  });

  const validIds = new Set(
    inputs.candidates.map((candidate) => candidate.assignmentId),
  );

  // Drop tasks referencing an assignment that wasn't in the input — a
  // hallucinated id would otherwise fail the insert and lose the whole plan.
  const tasks = result.data.tasks.filter(
    (task) => task.assignmentId === null || validIds.has(task.assignmentId),
  );
  const droppedTaskCount = result.data.tasks.length - tasks.length;

  // `date` is @db.Date, so normalise to midnight UTC for a stable unique key.
  const planDate = new Date(
    Date.UTC(
      inputs.date.getFullYear(),
      inputs.date.getMonth(),
      inputs.date.getDate(),
    ),
  );

  const plan = await prisma.$transaction(async (tx) => {
    const record = await tx.dailyPlan.upsert({
      where: { date: planDate },
      create: {
        date: planDate,
        generatedSummary: result.data.summary,
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      update: {
        generatedSummary: result.data.summary,
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
    });

    // Regenerating replaces the task list wholesale.
    await tx.planTask.deleteMany({ where: { dailyPlanId: record.id } });

    if (tasks.length > 0) {
      await tx.planTask.createMany({
        data: tasks.map((task, index) => ({
          dailyPlanId: record.id,
          position: index,
          title: task.title,
          reason: task.reason,
          estimatedMinutes: Math.min(
            240,
            Math.max(5, Math.round(task.estimatedMinutes)),
          ),
          assignmentId: task.assignmentId,
        })),
      });
    }

    return record;
  });

  return {
    planId: plan.id,
    date: planDate,
    taskCount: tasks.length,
    summary: result.data.summary,
    provider: result.provider,
    model: result.model,
    droppedTaskCount,
  };
}

export async function getTodaysPlan() {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );

  return prisma.dailyPlan.findUnique({
    where: { date: today },
    include: {
      tasks: {
        orderBy: { position: "asc" },
        include: {
          assignment: {
            select: { title: true, dueAt: true, course: { select: { name: true } } },
          },
        },
      },
    },
  });
}
