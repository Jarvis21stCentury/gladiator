import "server-only";

import { z } from "zod";

import { getCourseTrends } from "@/lib/analytics/trend";
import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { maxLevel, type StatusLevel } from "@/lib/status";
import { getActiveStruggles } from "@/lib/struggles/engine";

/**
 * The weekly retro (FEATURES.md Tier 2) — the Sunday summary: wins, struggles,
 * what to adjust.
 *
 * The counts are gathered deterministically and stored alongside the prose, so
 * the page can show the numbers next to the narrative. A retro that says "a
 * strong week" with nothing to check it against is worth very little; one that
 * says it beside "11 completed, 1 missed" is worth reading.
 *
 * Per ARCHITECTURE.md this is one of the three places the strong model is used —
 * it is a piece of writing, not a classification.
 */

const RetroSchema = z.strictObject({
  summary: z.string(),
  wins: z.array(z.string()),
  struggles: z.array(z.string()),
  adjustments: z.array(z.string()),
});

const SYSTEM_PROMPT = `You write one student's weekly review of their own schoolwork.

You get counted facts about the week just finished: what was completed, what was missed, how grades moved, what the system flagged, and how much time was logged.

Write:
- summary: three or four sentences to the student. What the week was actually like, and the one thing that most needs to change. Plain language, no headers, no greeting, no motivational filler.
- wins: up to four specific things that went well. Each must point at something in the data. "Kept up in Chemistry — all five assignments in on time" is a win; "stayed positive" is not.
- struggles: up to four things that did not. Same rule — specific and grounded.
- adjustments: two or three concrete changes for next week. An action the student could start on Monday, not a principle.

Use only the supplied facts. Do not invent assignments, grades, or reasons. If the week was quiet, say so briefly rather than padding it.`;

/** Monday of the week containing `date`, normalised to midnight UTC (@db.Date). */
export function weekStartOf(date: Date = new Date()): Date {
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);

  // getDay(): 0 = Sunday. Shift back to Monday.
  const offset = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - offset);

  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

/** The seven-day span a `weekStart` covers, as local Date boundaries. */
function weekRange(weekStart: Date): { from: Date; to: Date } {
  const from = new Date(
    weekStart.getUTCFullYear(),
    weekStart.getUTCMonth(),
    weekStart.getUTCDate(),
  );
  const to = new Date(from);
  to.setDate(to.getDate() + 7);

  return { from, to };
}

export interface RetroFacts {
  weekStart: Date;
  completed: { title: string; courseName: string; score: number | null; pointsPossible: number | null }[];
  missed: { title: string; courseName: string; pointsPossible: number | null }[];
  gradeMoves: { courseName: string; from: number; to: number }[];
  struggles: { title: string; description: string }[];
  minutesLogged: number;
  loggedItems: { title: string; estimatedMinutes: number | null; actualMinutes: number }[];
  planTasksDone: number;
  planTasksTotal: number;
  lessonNoteCount: number;
}

export async function gatherRetroFacts(weekStart: Date): Promise<RetroFacts> {
  const { from, to } = weekRange(weekStart);

  const [dueThisWeek, effortLogs, planTasks, trends, struggles, lessonNoteCount] =
    await Promise.all([
      prisma.assignment.findMany({
        where: { dueAt: { gte: from, lt: to } },
        include: { course: { select: { name: true } } },
        orderBy: { dueAt: "asc" },
      }),
      prisma.effortLog.findMany({
        where: { createdAt: { gte: from, lt: to } },
        include: { assignment: { select: { title: true } } },
      }),
      prisma.planTask.findMany({
        where: { dailyPlan: { date: { gte: weekStart } } },
        select: { done: true, dailyPlan: { select: { date: true } } },
      }),
      getCourseTrends(),
      getActiveStruggles(),
      prisma.lessonNote.count({ where: { date: { gte: weekStart } } }),
    ]);

  const weekEndUtc = new Date(weekStart);
  weekEndUtc.setUTCDate(weekEndUtc.getUTCDate() + 7);

  const tasksInWeek = planTasks.filter((task) => task.dailyPlan.date < weekEndUtc);

  // Grade movement inside the week only — the trend module's window is 45 days,
  // which is the wrong span for "how did this week go".
  const gradeMoves = trends
    .map((trend) => {
      const inWeek = trend.points.filter(
        (point) => point.date >= weekStart && point.date < weekEndUtc,
      );
      if (inWeek.length < 2) return null;

      const start = inWeek[0].gradePercent;
      const end = inWeek[inWeek.length - 1].gradePercent;
      if (Math.abs(end - start) < 0.75) return null;

      return { courseName: trend.courseName, from: start, to: end };
    })
    .filter((move): move is NonNullable<typeof move> => move !== null);

  return {
    weekStart,
    completed: dueThisWeek
      .filter((assignment) => assignment.submitted)
      .map((assignment) => ({
        title: assignment.title,
        courseName: assignment.course.name,
        score: assignment.score,
        pointsPossible: assignment.pointsPossible,
      })),
    missed: dueThisWeek
      .filter((assignment) => !assignment.submitted && assignment.dueAt! < new Date())
      .map((assignment) => ({
        title: assignment.title,
        courseName: assignment.course.name,
        pointsPossible: assignment.pointsPossible,
      })),
    gradeMoves,
    struggles: struggles.map((struggle) => ({
      title: struggle.title,
      description: struggle.description,
    })),
    minutesLogged: effortLogs.reduce((sum, log) => sum + log.actualMinutes, 0),
    loggedItems: effortLogs.map((log) => ({
      title: log.assignment.title,
      estimatedMinutes: log.estimatedMinutes,
      actualMinutes: log.actualMinutes,
    })),
    planTasksDone: tasksInWeek.filter((task) => task.done).length,
    planTasksTotal: tasksInWeek.length,
    lessonNoteCount,
  };
}

function buildPrompt(facts: RetroFacts): string {
  const { from, to } = weekRange(facts.weekStart);
  const endLabel = new Date(to.getTime() - 86_400_000);

  const lines: string[] = [
    `Week of ${from.toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ${endLabel.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`,
    "",
    `Completed on time: ${facts.completed.length}`,
    ...facts.completed.map(
      (item) =>
        `  - "${item.title}" (${item.courseName})${item.score !== null && item.pointsPossible ? ` — scored ${item.score}/${item.pointsPossible}` : ""}`,
    ),
    "",
    `Missed (past due, unsubmitted): ${facts.missed.length}`,
    ...facts.missed.map(
      (item) =>
        `  - "${item.title}" (${item.courseName})${item.pointsPossible ? ` — ${item.pointsPossible} pts` : ""}`,
    ),
    "",
    "Grade movement this week:",
    ...(facts.gradeMoves.length > 0
      ? facts.gradeMoves.map(
          (move) =>
            `  - ${move.courseName}: ${move.from.toFixed(1)}% → ${move.to.toFixed(1)}%`,
        )
      : ["  - no measurable movement"]),
    "",
    "Open flags from the struggles engine:",
    ...(facts.struggles.length > 0
      ? facts.struggles.map((struggle) => `  - ${struggle.title}: ${struggle.description}`)
      : ["  - none"]),
    "",
    `Study time logged: ${facts.minutesLogged} minutes across ${facts.loggedItems.length} items.`,
    ...facts.loggedItems.map(
      (item) =>
        `  - "${item.title}": ${item.actualMinutes} min actual${item.estimatedMinutes ? ` vs ${item.estimatedMinutes} min estimated` : ""}`,
    ),
    "",
    `Daily-plan tasks: ${facts.planTasksDone} of ${facts.planTasksTotal} checked off.`,
    `Nightly digests written: ${facts.lessonNoteCount}.`,
  ];

  return lines.join("\n");
}

export interface WeeklyRetroResult {
  retroId: string;
  weekStart: Date;
  summary: string;
  provider: string;
  model: string;
}

export async function generateWeeklyRetro(
  date: Date = new Date(),
): Promise<WeeklyRetroResult> {
  const weekStart = weekStartOf(date);
  const facts = await gatherRetroFacts(weekStart);

  const result = await generateJson({
    schemaName: "weekly_retro",
    schema: RetroSchema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(facts),
    // ARCHITECTURE.md: the retro is one of the three writing tasks.
    quality: "strong",
    maxOutputTokens: 3000,
  });

  const data = {
    summaryText: result.data.summary,
    wins: result.data.wins.slice(0, 4),
    struggles: result.data.struggles.slice(0, 4),
    adjustments: result.data.adjustments.slice(0, 3),
    assignmentsCompleted: facts.completed.length,
    assignmentsMissed: facts.missed.length,
    minutesLogged: facts.minutesLogged,
    provider: result.provider,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };

  const retro = await prisma.weeklyRetro.upsert({
    where: { weekStart },
    create: { weekStart, ...data },
    update: data,
  });

  return {
    retroId: retro.id,
    weekStart,
    summary: retro.summaryText,
    provider: retro.provider,
    model: retro.model,
  };
}

export async function getRetro(weekStart: Date) {
  return prisma.weeklyRetro.findUnique({ where: { weekStart } });
}

export interface ReplayDay {
  date: Date;
  items: {
    id: string;
    title: string;
    courseName: string;
    submitted: boolean;
    /** Null when nothing was graded — not the same as scoring zero. */
    score: number | null;
    pointsPossible: number | null;
    level: StatusLevel;
  }[];
  level: StatusLevel;
  minutesLogged: number;
}

/**
 * The week, day by day, for the compressed replay at the top of the retro page.
 *
 * A day's level is the worst thing that happened on it: anything due and still
 * unsubmitted makes it urgent, otherwise it stays calm. That is the same rule
 * the manifest rows use, applied backwards over a finished week.
 */
export async function getWeekReplay(weekStart: Date): Promise<ReplayDay[]> {
  const { from, to } = weekRange(weekStart);

  const [assignments, logs] = await Promise.all([
    prisma.assignment.findMany({
      where: { dueAt: { gte: from, lt: to } },
      orderBy: { dueAt: "asc" },
      include: { course: { select: { name: true } } },
    }),
    prisma.effortLog.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { createdAt: true, actualMinutes: true },
    }),
  ]);

  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(from);
    date.setDate(date.getDate() + offset);

    const next = new Date(date);
    next.setDate(next.getDate() + 1);

    const items = assignments
      .filter(
        (assignment) =>
          assignment.dueAt !== null &&
          assignment.dueAt >= date &&
          assignment.dueAt < next,
      )
      .map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        courseName: assignment.course.name,
        submitted: assignment.submitted,
        score: assignment.score,
        pointsPossible: assignment.pointsPossible,
        level: (assignment.submitted ? "calm" : "urgent") as StatusLevel,
      }));

    return {
      date,
      items,
      level: maxLevel(...items.map((item) => item.level)),
      minutesLogged: logs
        .filter((log) => log.createdAt >= date && log.createdAt < next)
        .reduce((sum, log) => sum + log.actualMinutes, 0),
    };
  });
}

/** Every week that has a stored retro, newest first — powers the week picker. */
export async function listRetroWeeks(): Promise<Date[]> {
  const rows = await prisma.weeklyRetro.findMany({
    orderBy: { weekStart: "desc" },
    select: { weekStart: true },
    take: 26,
  });

  return rows.map((row) => row.weekStart);
}
