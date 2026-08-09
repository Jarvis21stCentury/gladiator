import "server-only";

import { z } from "zod";

import { DIFFICULTY_LABEL } from "@/lib/effort/difficulty";
import { EFFORT_SOURCE_LABEL } from "@/lib/effort/estimate";
import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { getPlanInputs, type PlanCandidate, type PlanInputs } from "./gather";
import { buildSchedule, type ScheduleRequest } from "./schedule";

/**
 * The morning daily plan: a timed schedule for the evening plus a short summary.
 *
 * Two stages, and the split is the important part:
 *
 *   1. **The model decides.** Which work to do, in what order, how long to give
 *      each piece, and why. Judgement calls, on the strong model per
 *      ARCHITECTURE.md — the narrative is one of the few places where writing
 *      quality actually matters.
 *   2. **`schedule.ts` decides what happens at 5:20pm.** Ordinary, testable code
 *      lays those tasks onto the clock inside the hours actually free, splits
 *      long work into sessions, inserts breaks, and reserves dinner.
 *
 * The model is never asked for clock times. Laying out a day is constraint
 * satisfaction — no overlaps, inside the free windows, never past bedtime — and
 * the failure mode when a language model gets that wrong is quiet: a schedule
 * that reads plausibly and has you eating dinner twice.
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
- **Do not stop at today's deadlines.** Once today's due work is covered, keep going with work due later in the week. A day with nothing due is a day to get ahead, not a day off — and a big item due in five days should be started now, in a session or two, rather than becoming a crisis the night before. If the whole evening is spent on things due tonight, you have planned badly unless there was genuinely nothing left.
- Prefer starting a large future item early over finishing a small one that isn't due for a week. Progress on the thing that can ruin a week beats tidying up the thing that can't.
- Never schedule more than about half the evening on any single assignment when other work exists. Spread across what matters.
- The estimate you are given already accounts for how hard the student said this is, where they have rated it. Trust it.
- Only schedule what fits the available minutes. Leaving good work off today is correct; an unachievable plan is worse than a short one.
- Every task must use the assignmentId of the item it came from. Use null only for a task not tied to a listed assignment.
- Keep estimatedMinutes close to the supplied estimate unless you are splitting a large item into a first session today.
- reason: one short sentence, concrete about why this is placed here. Say plainly when something is being started early. No filler.
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

  // The student's own rating, where they gave one. Worth stating separately
  // from the estimate: it tells the model this number is trusted rather than
  // guessed, which changes how willing it should be to move it.
  if (candidate.difficulty != null) {
    parts.push(
      `they rated it ${candidate.difficulty}/5 (${DIFFICULTY_LABEL[candidate.difficulty]})`,
    );
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
    "Unsubmitted work, everything due in the next 10 days — not just today:",
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

  /*
   * Stage two. The model's minutes are clamped here rather than trusted: it is
   * asked to stay near the supplied estimate, but a hallucinated 900 would
   * otherwise swallow the whole evening before the layout pass could balance it.
   */
  const requests: ScheduleRequest[] = tasks.map((task) => ({
    assignmentId: task.assignmentId,
    title: task.title,
    reason: task.reason,
    minutes: Math.min(240, Math.max(5, Math.round(task.estimatedMinutes))),
  }));

  const schedule = buildSchedule(
    requests,
    inputs.freeWindows,
    inputs.date,
    inputs.scheduleOptions,
  );

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

    if (schedule.blocks.length > 0) {
      await tx.planTask.createMany({
        data: schedule.blocks.map((block, index) => ({
          dailyPlanId: record.id,
          position: index,
          kind: block.kind,
          title: block.title,
          reason: block.reason,
          estimatedMinutes: block.minutes,
          startAt: block.start,
          endAt: block.end,
          assignmentId: block.assignmentId,
        })),
      });
    }

    return record;
  });

  return {
    planId: plan.id,
    date: planDate,
    // Work blocks only — counting the breaks and dinner as "tasks" would make
    // the cron log and the sync toast report a busier day than was planned.
    taskCount: schedule.blocks.filter((block) => block.kind === "WORK").length,
    summary: result.data.summary,
    provider: result.provider,
    model: result.model,
    // Both kinds of loss: ids the model invented, and work the day had no room
    // for once dinner and breaks were reserved.
    droppedTaskCount: droppedTaskCount + schedule.dropped.length,
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
