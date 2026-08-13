"use server";

import { revalidatePath } from "next/cache";

import { schedule, type Rating } from "@/lib/flashcards/schedule";
import { prisma } from "@/lib/prisma";
import { parseClock } from "@/lib/routine/model";
import { saveSchoolYear } from "@/lib/school-year";

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

/* ==========================================================================
   YOUR OWN TASKS

   Work a student adds themselves — revision, a reading, a college essay, the
   half of school Canvas never hears about.

   These are `Assignment` rows with `source: MANUAL`, not a separate table, and
   that is the entire design. Every list, the two-week workload forecast, the
   timetable and the daily planner already read `Assignment`, so a task added
   here appears in all of them without one line of code changing. A parallel
   `Task` model would have meant merging two sources in about a dozen places and
   getting it subtly wrong in one of them.

   It is safe because the Canvas sync only ever *upserts by `canvasId`* and never
   deletes: a row with a null `canvasId` is invisible to it. The syllabus parser
   already relies on the same property.

   Two rules the actions below enforce:

     1. Only MANUAL rows can be completed or deleted here. A Canvas assignment's
        `submitted` flag is owned by Canvas — ticking it locally would silently
        flip back on the next sync, which is worse than not offering it.
     2. A task must have a due date. Everything in this product is time and
        pressure; the queries that build every list filter on `dueAt`, so a task
        without one would save successfully and then be invisible.
   ========================================================================== */

/** Long enough for a real task title, short enough to stay one line in a row. */
const MAX_TITLE = 160;

export async function createTask(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const title = String(formData.get("title") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "");
  const date = String(formData.get("dueDate") ?? "").trim();
  const time = String(formData.get("dueTime") ?? "").trim();

  if (!title) return { ok: false, message: "Give the task a name." };

  if (title.length > MAX_TITLE) {
    return { ok: false, message: `Keep the name under ${MAX_TITLE} characters.` };
  }

  if (!courseId) return { ok: false, message: "Pick a class." };
  if (!date) return { ok: false, message: "Pick a due date." };

  /*
   * Built from the parts rather than parsed from a string: `new Date("2026-08-05")`
   * is treated as UTC midnight, which lands on the *previous* day for anyone
   * west of Greenwich — a task due Friday would file itself under Thursday.
   * Reading the fields into a local-time constructor keeps the date the one the
   * person picked.
   */
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time || "23:59").split(":").map(Number);

  if (!year || !month || !day) {
    return { ok: false, message: "That due date isn't a real date." };
  }

  // Defaults to 11:59 PM, matching what Canvas assignments almost always use,
  // so a hand-added task sorts alongside them instead of jumping to the top.
  const dueAt = new Date(year, month - 1, day, hour ?? 23, minute ?? 59);

  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, message: "That due date isn't a real date." };
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });

  if (!course) return { ok: false, message: "That class no longer exists." };

  await prisma.assignment.create({
    data: {
      title,
      courseId: course.id,
      dueAt,
      source: "MANUAL",
      // Deliberately null. Manual tasks are work, not graded points, and the
      // what-if calculator filters on `pointsPossible > 0` — so leaving this
      // unset is what keeps your own to-dos out of your grade projection.
      pointsPossible: null,
    },
  });

  // It lands in the due lists, the forecast and the timetable at once.
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/classes");

  return { ok: true, message: `Added "${title}" to ${course.name}.` };
}

/** Tick your own task off, or put it back. */
export async function toggleTaskDone(formData: FormData): Promise<void> {
  const id = String(formData.get("taskId") ?? "");
  if (!id) return;

  const task = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true, submitted: true, source: true },
  });

  // Canvas owns `submitted` on its own rows: the next sync would overwrite this.
  if (!task || task.source !== "MANUAL") return;

  await prisma.assignment.update({
    where: { id: task.id },
    data: { submitted: !task.submitted },
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/classes");
}

/** Delete a task you added. */
export async function deleteTask(formData: FormData): Promise<void> {
  const id = String(formData.get("taskId") ?? "");
  if (!id) return;

  const task = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true, source: true },
  });

  // Deleting a Canvas row would only make it reappear on the next sync.
  if (!task || task.source !== "MANUAL") return;

  // Safe: the schema cascades effort logs and nulls the assignment link on
  // plan tasks and calendar blocks, so nothing is orphaned.
  await prisma.assignment.delete({ where: { id: task.id } });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/classes");
}

/**
 * Rate how hard an assignment is, 1–5, or clear the rating.
 *
 * This is the only signal in the product for the thing Canvas cannot see: a
 * 10-point problem set on a topic you have not understood is a bigger evening
 * than a 100-point worksheet you could do asleep. It feeds effort estimation,
 * which feeds the workload forecast and the daily schedule — so one tap here
 * changes how much of your evening the planner sets aside for it.
 *
 * Allowed on Canvas assignments as well as your own tasks: it is *your* opinion
 * of the work, not a property of the row, and nothing on the Canvas side is
 * touched by it, so a sync cannot overwrite it.
 */
export async function setAssignmentDifficulty(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("assignmentId") ?? "");
  if (!id) return;

  const raw = String(formData.get("difficulty") ?? "").trim();
  // An empty value clears the rating. That is distinct from rating something
  // "normal": unrated means "estimate this the way you always did".
  const difficulty = raw === "" ? null : Number(raw);

  if (
    difficulty !== null &&
    (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5)
  ) {
    return;
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!assignment) return;

  await prisma.assignment.update({
    where: { id: assignment.id },
    data: { difficulty },
  });

  // Every estimate downstream just moved: the forecast, the class dossier and
  // tomorrow's schedule all price this assignment differently now.
  revalidatePath("/");
  revalidatePath("/classes");
  revalidatePath("/calendar");
}

/** Check a work block off today's schedule. */
export async function togglePlanTask(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return;

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    select: { id: true, done: true, kind: true },
  });

  // Breaks and dinner are rows in the schedule, not things you complete. The UI
  // does not render a control for them; this is the guard behind that.
  if (!task || task.kind !== "WORK") return;

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

/* ==========================================================================
   THE WEEKLY ROUTINE

   When you wake, when school ends, when practice runs, when you go to bed.
   This is what turns "free time" from a guess into a fact — see
   `lib/routine/model.ts` for why it is stored as clock minutes rather than
   timestamps, and how sleep bounds a day rather than sitting inside it.
   ========================================================================== */

/** Add one block, optionally repeated across several days at once. */
export async function addRoutineBlock(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const label = String(formData.get("label") ?? "").trim();
  const kind = String(formData.get("kind") ?? "ACTIVITY");
  const start = parseClock(String(formData.get("start") ?? ""));
  const end = parseClock(String(formData.get("end") ?? ""));

  // Checkboxes named `days`, so one submission can cover Tue *and* Thu — which
  // is how practice actually works, and typing it twice is how a setup screen
  // gets abandoned halfway through.
  const days = formData
    .getAll("days")
    .map((value) => Number(value))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  if (!label) return { ok: false, message: "Give it a name." };
  if (start === null || end === null) {
    return { ok: false, message: "Use times like 15:40." };
  }
  if (days.length === 0) return { ok: false, message: "Pick at least one day." };

  const validKind =
    kind === "SLEEP" || kind === "SCHOOL" || kind === "PERSONAL"
      ? kind
      : "ACTIVITY";

  /*
   * Sleep is the one kind where start and end are allowed to look backwards:
   * bedtime 22:30, wake 07:00. Everything else must run forwards within a day,
   * or the free-time walk silently loses the rest of the evening.
   */
  if (validKind !== "SLEEP" && end <= start) {
    return { ok: false, message: "The end has to be after the start." };
  }

  await prisma.$transaction(
    days.map((dayOfWeek) =>
      prisma.routineBlock.create({
        data: {
          dayOfWeek,
          kind: validKind,
          label,
          startMinutes: start,
          endMinutes: end,
        },
      }),
    ),
  );

  revalidateRoutine();

  return {
    ok: true,
    message: `Added "${label}" on ${days.length} day${days.length === 1 ? "" : "s"}.`,
  };
}

export async function deleteRoutineBlock(formData: FormData): Promise<void> {
  const id = String(formData.get("blockId") ?? "");
  if (!id) return;

  await prisma.routineBlock.deleteMany({ where: { id } });
  revalidateRoutine();
}

/**
 * A believable school week, in one press.
 *
 * An empty routine screen asks a tired student to enter thirty-five values
 * before the app is any use, which is exactly where people give up. This fills
 * in the shape almost everyone has — wake, school, sleep, a later weekend — and
 * leaves them editing something rather than authoring it.
 */
export async function seedTypicalWeek(): Promise<void> {
  const existing = await prisma.routineBlock.count();
  if (existing > 0) return;

  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [0, 6];

  await prisma.$transaction([
    ...weekdays.flatMap((dayOfWeek) => [
      prisma.routineBlock.create({
        data: {
          dayOfWeek,
          kind: "SLEEP" as const,
          label: "Sleep",
          startMinutes: 22 * 60 + 30,
          endMinutes: 7 * 60,
        },
      }),
      prisma.routineBlock.create({
        data: {
          dayOfWeek,
          kind: "SCHOOL" as const,
          label: "School",
          startMinutes: 8 * 60 + 15,
          endMinutes: 15 * 60 + 20,
        },
      }),
    ]),
    ...weekend.map((dayOfWeek) =>
      prisma.routineBlock.create({
        data: {
          dayOfWeek,
          kind: "SLEEP" as const,
          label: "Sleep",
          startMinutes: 23 * 60 + 30,
          endMinutes: 9 * 60,
        },
      }),
    ),
  ]);

  revalidateRoutine();
}

/** The routine changes every free-time figure in the product. */
function revalidateRoutine(): void {
  revalidatePath("/routine");
  revalidatePath("/");
  revalidatePath("/calendar");
}

/* ==========================================================================
   CLASSES AND GRADES BY HAND

   Canvas is the fastest way to fill this app, and it is not the only way. Many
   schools keep assignments in Canvas and grades in something else entirely, and
   some classes are in neither. Everything below exists so the app is usable
   without waiting on an integration.
   ========================================================================== */

/** Add a class that isn't coming from Canvas. */
export async function createCourse(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const term = String(formData.get("term") ?? "").trim();

  if (!name) return { ok: false, message: "Give the class a name." };
  if (name.length > 80) {
    return { ok: false, message: "Keep the name under 80 characters." };
  }

  const existing = await prisma.course.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });

  if (existing) {
    return { ok: false, message: `"${name}" already exists.` };
  }

  // `canvasId` stays null — that is what marks this as yours rather than
  // Canvas's, and it is why a sync will never overwrite or delete it.
  await prisma.course.create({
    data: { name, term: term || null },
  });

  revalidatePath("/classes");
  revalidatePath("/");

  return { ok: true, message: `Added ${name}.` };
}

/**
 * Set a class's current grade by hand.
 *
 * Writes the course's headline figure *and* a snapshot for today, because the
 * grade trend on the front page is built from snapshots. Setting a grade with
 * no snapshot would show the new number with a trend line that never moved.
 *
 * One snapshot per course per day (the schema enforces it), so correcting a
 * typo twice in an evening updates today's point rather than creating two.
 */
export async function setCourseGrade(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const courseId = String(formData.get("courseId") ?? "");
  const raw = String(formData.get("percent") ?? "").trim();

  if (!courseId) return { ok: false, message: "Pick a class." };

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });

  if (!course) return { ok: false, message: "That class no longer exists." };

  // Empty clears the grade — distinct from a grade of zero.
  if (raw === "") {
    // Clearing also drops the provenance, which is what hands the field back to
    // the syncs — otherwise a cleared grade would stay MANUAL forever and HAC
    // could never post one again.
    await prisma.course.update({
      where: { id: course.id },
      data: { currentGradePercent: null, gradeSource: null },
    });
    revalidatePath("/classes");
    revalidatePath("/");
    return { ok: true, message: `Cleared the grade for ${course.name}.` };
  }

  const percent = Number(raw);

  if (!Number.isFinite(percent) || percent < 0 || percent > 150) {
    return { ok: false, message: "Enter a percent between 0 and 150." };
  }

  // @db.Date, so normalise to midnight UTC for a stable unique key — the same
  // convention the daily plan uses.
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );

  await prisma.$transaction([
    prisma.course.update({
      where: { id: course.id },
      data: { currentGradePercent: percent, gradeSource: "MANUAL" },
    }),
    prisma.gradeSnapshot.upsert({
      where: { courseId_date: { courseId: course.id, date: today } },
      create: { courseId: course.id, date: today, gradePercent: percent },
      update: { gradePercent: percent },
    }),
  ]);

  revalidatePath("/classes");
  revalidatePath("/");

  return { ok: true, message: `${course.name} set to ${percent}%.` };
}

/**
 * Hide a class from every list, or bring it back.
 *
 * Not a delete: the next Canvas sync would simply recreate it. Hiding is the
 * honest operation for "this is an enrolment, not a class" — homeroom, a club,
 * a district orientation course.
 */
export async function toggleCourseHidden(formData: FormData): Promise<void> {
  const id = String(formData.get("courseId") ?? "");
  if (!id) return;

  const course = await prisma.course.findUnique({
    where: { id },
    select: { id: true, hidden: true },
  });

  if (!course) return;

  await prisma.course.update({
    where: { id: course.id },
    data: { hidden: !course.hidden },
  });

  revalidatePath("/classes");
  revalidatePath("/");
  revalidatePath("/calendar");
}

/**
 * Set the school year every list is bounded by.
 *
 * Defaults to Frisco ISD's published 2026-27 calendar, which is a fact about
 * one district — so it is editable rather than compiled in.
 */
export async function setSchoolYear(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const start = String(formData.get("start") ?? "").trim();
  const end = String(formData.get("end") ?? "").trim();

  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (!isDate(start) || !isDate(end)) {
    return { ok: false, message: "Pick both dates." };
  }

  if (start >= end) {
    return { ok: false, message: "The last day has to be after the first day." };
  }

  await saveSchoolYear(start, end);

  // Every list, the forecast and the planner are bounded by this.
  revalidatePath("/");
  revalidatePath("/classes");
  revalidatePath("/calendar");
  revalidatePath("/routine");

  return { ok: true, message: "School year updated." };
}
