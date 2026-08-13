import "server-only";

import { z } from "zod";

import { generateJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { planCourseworkTasks } from "./coursework-plan";

/**
 * Turning "Practice Set 1.1, problems 1-20, due Friday" into a task.
 *
 * A teacher's coursework page is where homework is actually announced. Half of
 * it never becomes a Canvas assignment — it is a page instruction, a reading, a
 * "bring your annotated article Monday" — so it existed nowhere in this app,
 * which meant the planner scheduled around work the student still had to do.
 *
 * ## What this is allowed to get wrong
 *
 * Everything here is inferred by a model from prose, so rows land as
 * `AssignmentSource.COURSEWORK` and the UI treats them like the student's own
 * tasks: tickable, deletable. That is not a detail — it is the deal. An
 * inferred row the student cannot remove would make every list untrustworthy
 * the first time the model imagined something.
 *
 * Two hard rules keep the damage bounded:
 *
 *   1. **Canvas always wins.** If an assignment with this title already exists
 *      from any source, nothing is created. Canvas carries points, submission
 *      state and a real link; a guessed duplicate sitting beside it is worse
 *      than nothing.
 *   2. **No date, no row.** Every list, the forecast and the planner key off a
 *      due date. An undated task is invisible, so creating one is storing a row
 *      nobody will ever see.
 */

const TaskSchema = z.strictObject({
  assignments: z.array(
    z.strictObject({
      /** What a student would call it: "Practice Set 1.1". */
      title: z.string(),
      /** ISO calendar date, YYYY-MM-DD. */
      dueDate: z.string(),
      /** Verbatim words the due date came from, so a wrong read is traceable. */
      quote: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You read one day's entry from a teacher's course page and list the work the student has to do.

Include an item only if all three are true:
- It is work the student does, not something the teacher did in class. "Went over the grading policy" is not work; "read section 2.3" is.
- It has a due date you can pin to a specific calendar day, either printed ("due 8/15") or relative ("due Friday", "due tomorrow", "for next class"). Resolve relative dates against the date given below.
- It is stated, not implied. Never add the homework a class like this usually has.

title: what the student would call it — "Practice Set 1.1", "Lab safety contract", "Read section 2.3". No due date in the title, no class name, no "Homework:" prefix.

dueDate: ISO YYYY-MM-DD. If a relative date cannot be resolved to one specific day, leave the item out entirely.

quote: the exact words from the page that state the deadline. Copy them; do not paraphrase.

Return an empty list when the page has no assigned work. That is a normal and common answer — a day of lecture with nothing due is not a failure to find something.`;


/** Coursework text long enough to matter, short enough to be one prompt. */
const MAX_CHARS = 8_000;

export interface CourseworkTaskResult {
  created: number;
  /** Titles that already existed, from Canvas or an earlier read of this page. */
  skippedExisting: number;
  /** Items the model returned that had no usable date. */
  skippedUndated: number;
  titles: string[];
}

export async function extractCourseworkTasks({
  courseId,
  text,
  day,
}: {
  courseId: string;
  text: string;
  day: Date;
}): Promise<CourseworkTaskResult> {
  const empty: CourseworkTaskResult = {
    created: 0,
    skippedExisting: 0,
    skippedUndated: 0,
    titles: [],
  };

  if (text.trim().length < 40) return empty;

  const result = await generateJson({
    schemaName: "coursework_tasks",
    schema: TaskSchema,
    system: SYSTEM_PROMPT,
    prompt: [
      // The weekday is here so "due Friday" resolves. Without it the model has
      // to guess which day of the week the page belongs to, and guesses wrong.
      `Today is ${day.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })} (${day.toISOString().slice(0, 10)}).`,
      "",
      "Course page entry for today:",
      "",
      text.slice(0, MAX_CHARS),
    ].join("\n"),
    quality: "fast",
    maxOutputTokens: 2000,
  });

  if (result.data.assignments.length === 0) return empty;

  /*
   * Every assignment this class already has, keyed loosely.
   *
   * Not scoped to a date window on purpose: the point is to avoid duplicating
   * an assignment that exists *at all*, and a Canvas row dated next month is
   * still the same piece of work as the one the page just mentioned.
   */
  const existing = await prisma.assignment.findMany({
    where: { courseId },
    select: { title: true },
  });

  const plan = planCourseworkTasks(
    result.data.assignments,
    existing.map((row) => row.title),
  );

  for (const task of plan.create) {
    await prisma.assignment.create({
      data: {
        courseId,
        title: task.title,
        dueAt: task.dueAt,
        source: "COURSEWORK",
        canvasId: null,
        // No points: the page almost never says, and inventing a weight would
        // feed a fabricated number straight into the grade calculator.
        pointsPossible: null,
      },
    });
  }

  return {
    created: plan.create.length,
    skippedExisting: plan.skippedExisting,
    skippedUndated: plan.skippedUndated,
    titles: plan.create.map((task) => task.title),
  };
}
