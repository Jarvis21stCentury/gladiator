import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Demo data for local development.
 *
 * This exists because every screen in this app is a view onto a database that
 * starts empty, and an empty Gladiator looks identical whether it is working
 * perfectly or not working at all. Running this fills in a plausible mid-
 * semester week so the dashboard, the trends, the radar and the struggles
 * engine all have something real to compute over.
 *
 * It is not fixtures for tests and it is not production data. Everything it
 * writes is marked: courses use negative Canvas ids, and the plan / digest /
 * retro rows record `provider: "seed"` instead of a model name, so nothing here
 * can ever be mistaken for something a model actually wrote.
 *
 *   npm run db:seed          # wipe the demo rows and rewrite them
 *
 * Re-running is safe: it deletes courses with negative Canvas ids first, and
 * the cascades in the schema take their assignments, snapshots and notes with
 * them.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Marks a row as demo data. Real Canvas ids are always positive. */
const SEED_MARKER = "seed";

function day(offset: number, hour = 23, minute = 59): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

/** Midnight UTC — the normalisation @db.Date columns expect. */
function dateOnly(offset: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
}

interface SeedAssignment {
  title: string;
  dayOffset: number;
  points: number;
  /** Omit for work that isn't due yet. */
  submitted?: boolean;
  /** Fraction of `points` earned. Only used when submitted. */
  scoreRatio?: number;
  category?: string;
}

interface SeedCourse {
  canvasId: number;
  name: string;
  /** Current grade. Null means Canvas hasn't posted one. */
  grade: number | null;
  /** Grade 20 days ago, interpolated forward to `grade`. */
  gradeThen: number;
  /** Bends the trend line down at the end — drives the slide detection. */
  slide?: boolean;
  categories?: { name: string; weight: number }[];
  assignments: SeedAssignment[];
}

/**
 * Six classes with deliberately different shapes, so every rule in the
 * struggles engine has something to find and the orb has a reason to be amber:
 *
 *   Chemistry   — a missed cluster and a grade slide
 *   US History  — a research paper landing on an already-heavy day
 *   Spanish III — healthy, nothing wrong, the control case
 *   Calculus    — weighted categories from a parsed syllabus, borderline grade
 *   English Lit — fine, with an essay due soon
 *   Physics     — quiet: no grade posted yet
 */
const COURSES: SeedCourse[] = [
  {
    canvasId: -101,
    name: "Chemistry — Honors",
    grade: 74.2,
    gradeThen: 81.5,
    slide: true,
    assignments: [
      { title: "Lab report: titration curves", dayOffset: -11, points: 50 },
      { title: "Problem set 7 — stoichiometry", dayOffset: -6, points: 25 },
      { title: "Reading check: Ch. 9", dayOffset: -4, points: 10, submitted: true, scoreRatio: 0.7 },
      { title: "Problem set 8 — gas laws", dayOffset: -2, points: 25 },
      { title: "Unit 4 test", dayOffset: 3, points: 100 },
      { title: "Lab report: calorimetry", dayOffset: 6, points: 50 },
    ],
  },
  {
    canvasId: -102,
    name: "US History",
    grade: 88.6,
    gradeThen: 87.1,
    assignments: [
      { title: "Primary source analysis", dayOffset: -9, points: 30, submitted: true, scoreRatio: 0.93 },
      { title: "Reconstruction reading quiz", dayOffset: -3, points: 20, submitted: true, scoreRatio: 0.85 },
      { title: "Research paper — first draft", dayOffset: 3, points: 100 },
      { title: "Chapter 14 outline", dayOffset: 8, points: 20 },
      { title: "Research paper — final", dayOffset: 15, points: 150 },
    ],
  },
  {
    canvasId: -103,
    name: "Spanish III",
    grade: 94.8,
    gradeThen: 93.9,
    assignments: [
      { title: "Composición 4", dayOffset: -8, points: 40, submitted: true, scoreRatio: 0.95 },
      { title: "Vocabulario capítulo 6", dayOffset: -2, points: 15, submitted: true, scoreRatio: 1 },
      { title: "Presentación oral", dayOffset: 4, points: 60 },
      { title: "Examen capítulo 6", dayOffset: 9, points: 100 },
    ],
  },
  {
    canvasId: -104,
    name: "AP Calculus AB",
    grade: 86.1,
    gradeThen: 84.4,
    // Weighted categories, as though a syllabus had been parsed for this class.
    categories: [
      { name: "Tests", weight: 50 },
      { name: "Quizzes", weight: 25 },
      { name: "Homework", weight: 15 },
      { name: "Participation", weight: 10 },
    ],
    assignments: [
      { title: "Homework 5.3 — related rates", dayOffset: -7, points: 20, submitted: true, scoreRatio: 0.9, category: "Homework" },
      { title: "Quiz: implicit differentiation", dayOffset: -5, points: 40, submitted: true, scoreRatio: 0.78, category: "Quizzes" },
      { title: "Homework 5.4 — optimisation", dayOffset: -1, points: 20, submitted: true, scoreRatio: 0.95, category: "Homework" },
      { title: "Unit 5 test — applications of derivatives", dayOffset: 3, points: 150, category: "Tests" },
      { title: "Homework 6.1 — antiderivatives", dayOffset: 5, points: 20, category: "Homework" },
      { title: "Quiz: Riemann sums", dayOffset: 11, points: 40, category: "Quizzes" },
    ],
  },
  {
    canvasId: -105,
    name: "English Literature",
    grade: 91.3,
    gradeThen: 90.2,
    assignments: [
      { title: "Annotated bibliography", dayOffset: -10, points: 30, submitted: true, scoreRatio: 0.9 },
      { title: "Close reading — Act III", dayOffset: -2, points: 25, submitted: true, scoreRatio: 0.92 },
      { title: "Comparative essay", dayOffset: 3, points: 100 },
      { title: "Socratic seminar prep", dayOffset: 7, points: 25 },
    ],
  },
  {
    canvasId: -106,
    name: "Physics I",
    grade: null,
    gradeThen: 0,
    assignments: [
      { title: "Kinematics problem set", dayOffset: 2, points: 30 },
      { title: "Lab: projectile motion", dayOffset: 9, points: 50 },
    ],
  },
];

async function clearSeedData() {
  // Cascades take assignments, snapshots, notes, categories and flags with the
  // course, so this is the only delete that has to name anything.
  await prisma.course.deleteMany({ where: { canvasId: { lt: 0 } } });
  await prisma.struggleFlag.deleteMany({ where: { courseId: null } });
  await prisma.dailyPlan.deleteMany({ where: { provider: SEED_MARKER } });
  await prisma.weeklyRetro.deleteMany({ where: { provider: SEED_MARKER } });
  await prisma.flashcard.deleteMany({ where: { provider: SEED_MARKER } });
  await prisma.syncRun.deleteMany({});
  await prisma.calendarBlock.deleteMany({});
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }

  console.log("Clearing previous demo data…");
  await clearSeedData();

  const courseIds = new Map<number, string>();

  for (const seed of COURSES) {
    const course = await prisma.course.create({
      data: {
        canvasId: seed.canvasId,
        name: seed.name,
        term: "Fall 2026",
        currentGradePercent: seed.grade,
      },
    });

    courseIds.set(seed.canvasId, course.id);

    // --- Grade categories -------------------------------------------------
    const categoryIds = new Map<string, string>();

    for (const category of seed.categories ?? []) {
      const record = await prisma.gradeCategory.create({
        data: {
          courseId: course.id,
          name: category.name,
          weightPercent: category.weight,
          source: "SYLLABUS",
        },
      });
      categoryIds.set(category.name, record.id);
    }

    if (seed.categories) {
      await prisma.syllabusImport.create({
        data: {
          courseId: course.id,
          fileName: "calculus-syllabus-fall-2026.pdf",
          datesFound: 4,
          categoriesFound: seed.categories.length,
          warnings: [],
          provider: SEED_MARKER,
          model: "demo",
        },
      });
    }

    // --- Assignments ------------------------------------------------------
    for (const [index, assignment] of seed.assignments.entries()) {
      await prisma.assignment.create({
        data: {
          // Negative and unique, same marker as the course.
          canvasId: seed.canvasId * 1000 - index,
          courseId: course.id,
          title: assignment.title,
          dueAt: day(assignment.dayOffset),
          pointsPossible: assignment.points,
          submitted: assignment.submitted ?? false,
          score:
            assignment.submitted && assignment.scoreRatio !== undefined
              ? Math.round(assignment.points * assignment.scoreRatio)
              : null,
          gradeCategoryId: assignment.category
            ? (categoryIds.get(assignment.category) ?? null)
            : null,
        },
      });
    }

    // --- Grade snapshots --------------------------------------------------
    // One per weekday for the last three weeks. Chemistry's last three points
    // bend downward so the slide rule has a genuine pattern to find rather than
    // a straight line with noise on it.
    if (seed.grade !== null) {
      const points = 15;

      for (let step = 0; step < points; step += 1) {
        const offset = -(points - 1 - step) * 1.4;
        const progress = step / (points - 1);

        let value = seed.gradeThen + (seed.grade - seed.gradeThen) * progress;

        if (seed.slide) {
          // Hold flat, then drop over the final three readings.
          const held = seed.gradeThen - 0.6 * progress * 4;
          value =
            step < points - 3
              ? held
              : held - (step - (points - 4)) * ((held - seed.grade) / 3);
        }

        await prisma.gradeSnapshot.create({
          data: {
            courseId: course.id,
            date: dateOnly(Math.round(offset)),
            gradePercent: Math.round(value * 10) / 10,
          },
        });
      }
    }
  }

  // --- Effort logs --------------------------------------------------------
  // Enough comparable logs to switch the calibration engine on, and skewed long
  // on purpose: this student underestimates, which is exactly the bias the
  // planner is supposed to learn.
  const loggable = await prisma.assignment.findMany({
    where: { submitted: true, courseId: { in: [...courseIds.values()] } },
    take: 6,
  });

  const logs = [
    { actual: 95, estimated: 60, note: "Kept re-reading the prompt." },
    { actual: 50, estimated: 40, note: null },
    { actual: 75, estimated: 45, note: "Sources took longer than the writing." },
    { actual: 30, estimated: 25, note: null },
    { actual: 110, estimated: 75, note: "Started too late to think clearly." },
    { actual: 40, estimated: 30, note: null },
  ];

  for (const [index, assignment] of loggable.entries()) {
    const log = logs[index % logs.length];

    await prisma.effortLog.create({
      data: {
        assignmentId: assignment.id,
        actualMinutes: log.actual,
        estimatedMinutes: log.estimated,
        note: log.note,
      },
    });
  }

  // --- Calendar commitments ------------------------------------------------
  // Real commitments, not deadline markers — these are what eat the study
  // window and make the radar's busy days genuinely tight.
  const commitments = [
    { title: "Cross country practice", dayOffset: 0, start: 16, hours: 1.5 },
    { title: "Cross country practice", dayOffset: 1, start: 16, hours: 1.5 },
    { title: "Robotics club", dayOffset: 2, start: 17, hours: 2 },
    { title: "Cross country meet", dayOffset: 3, start: 15, hours: 3.5 },
    { title: "Shift at the library", dayOffset: 5, start: 13, hours: 4 },
    { title: "Cross country practice", dayOffset: 7, start: 16, hours: 1.5 },
  ];

  for (const commitment of commitments) {
    const start = day(commitment.dayOffset, commitment.start, 0);
    const end = new Date(start.getTime() + commitment.hours * 3_600_000);

    await prisma.calendarBlock.create({
      data: {
        title: commitment.title,
        start,
        end,
        type: "PERSONAL",
      },
    });
  }

  // --- Today's plan ---------------------------------------------------------
  const chemistry = courseIds.get(-101)!;
  const planAssignments = await prisma.assignment.findMany({
    where: { submitted: false },
    orderBy: { dueAt: "asc" },
    take: 4,
  });

  const plan = await prisma.dailyPlan.create({
    data: {
      date: dateOnly(0),
      generatedSummary:
        "Today is about stopping the Chemistry bleeding — two problem sets are already past due and the unit test is in three days. Get problem set 8 in first, then start the comparative essay; it is the one item that cannot be done in a single sitting on Thursday.",
      provider: SEED_MARKER,
      model: "demo",
      tasks: {
        create: planAssignments.map((assignment, index) => ({
          position: index,
          title: assignment.title,
          reason: [
            "Overdue and the smallest of the three — clearing it takes the class off the critical list.",
            "Due in three days and worth 150 points; a first pass today makes Thursday survivable.",
            "The test is close enough that review has to start before the weekend.",
            "Short, and doing it now keeps it off an already-heavy Friday.",
          ][index % 4],
          estimatedMinutes: [45, 75, 60, 30][index % 4],
          assignmentId: assignment.id,
          done: index === 0,
        })),
      },
    },
  });

  // --- Nightly digest -------------------------------------------------------
  const chemistryNote = await prisma.lessonNote.create({
    data: {
      date: dateOnly(0),
      courseId: chemistry,
      sourceType: "MIXED",
      rawInputRef: "Canvas module 4; textbook pp. 204–209",
      generatedSummary:
        "Today extended the gas laws into the ideal gas equation and introduced calorimetry as the bridge into thermochemistry. The lab on Friday assumes you can rearrange PV = nRT for any single variable without looking it up.",
      keyPoints: [
        "PV = nRT combines Boyle's, Charles's and Avogadro's laws; R is 0.0821 L·atm/(mol·K) when pressure is in atmospheres.",
        "Temperature in any gas-law calculation must be in Kelvin — this is the single most common source of wrong answers on the unit test.",
        "At standard temperature and pressure, one mole of an ideal gas occupies 22.4 L. Useful as a sanity check on an answer.",
        "Calorimetry measures heat transfer as q = mcΔT, where c is the specific heat capacity of the substance absorbing the heat.",
        "A coffee-cup calorimeter is assumed to lose no heat to the surroundings; the lab writeup asks you to name that assumption as a source of error.",
      ],
      provider: SEED_MARKER,
      model: "demo",
    },
  });

  /* --- Flashcards -----------------------------------------------------------
   * Written from the digest key points above, which is exactly what the real
   * generator does — one card per point. Scheduling state is spread out on
   * purpose so the review screen has something honest to show: a couple due
   * now, one never seen, one already pushed weeks out.
   */
  const chemistryCards = [
    {
      front: "What does each symbol in PV = nRT stand for, and what is R when pressure is in atmospheres?",
      back: "Pressure, volume, moles, the gas constant and temperature. R = 0.0821 L·atm/(mol·K).",
      hint: "Canvas module 4",
      dueDays: -1,
      intervalDays: 3,
      repetitions: 2,
      lapses: 0,
    },
    {
      front: "Which temperature unit must every gas-law calculation use?",
      back: "Kelvin. Using Celsius is the most common source of wrong answers on the unit test.",
      hint: "Canvas module 4",
      dueDays: 0,
      intervalDays: 1,
      repetitions: 1,
      lapses: 1,
    },
    {
      front: "What volume does one mole of an ideal gas occupy at STP?",
      back: "22.4 litres — a quick sanity check on any gas-law answer.",
      hint: null,
      dueDays: 0,
      intervalDays: 6,
      repetitions: 3,
      lapses: 0,
    },
    {
      front: "Write the calorimetry equation and say what c represents.",
      back: "q = mcΔT. c is the specific heat capacity of the substance absorbing the heat.",
      hint: "Textbook pp. 204–209",
      dueDays: null, // never seen
      intervalDays: 0,
      repetitions: 0,
      lapses: 0,
    },
    {
      front: "What assumption does a coffee-cup calorimeter make, and why does the lab writeup ask for it?",
      back: "That no heat is lost to the surroundings. It has to be named as a source of error.",
      hint: "Textbook pp. 204–209",
      dueDays: 21,
      intervalDays: 21,
      repetitions: 4,
      lapses: 0,
    },
  ];

  for (const [index, card] of chemistryCards.entries()) {
    const dueAt = new Date();
    if (card.dueDays !== null) dueAt.setDate(dueAt.getDate() + card.dueDays);

    await prisma.flashcard.create({
      data: {
        courseId: chemistry,
        lessonNoteId: chemistryNote.id,
        front: card.front,
        back: card.back,
        hint: card.hint,
        signature: `seed-chemistry-${index}`,
        dueAt,
        intervalDays: card.intervalDays,
        repetitions: card.repetitions,
        lapses: card.lapses,
        easeFactor: card.lapses > 0 ? 2.3 : 2.5,
        lastReviewedAt: card.dueDays === null ? null : new Date(),
        provider: SEED_MARKER,
        model: "demo",
      },
    });
  }

  // --- Last week's retro ----------------------------------------------------
  const lastWeekStart = new Date(dateOnly(0));
  lastWeekStart.setUTCDate(
    lastWeekStart.getUTCDate() - ((lastWeekStart.getUTCDay() + 6) % 7) - 7,
  );

  await prisma.weeklyRetro.create({
    data: {
      weekStart: lastWeekStart,
      summaryText:
        "A mixed week. Everything in Spanish, English and Calculus went in on time and the grades held, but Chemistry slipped again — two assignments passed their due date unsubmitted and the class average dropped for the second check running. The pattern is that Chemistry work is being left for the end of the evening and running out of time; moving it first is the single change most likely to fix the rest.",
      wins: [
        "All four Spanish and English items submitted on time, with nothing below 90%.",
        "Calculus homework 5.4 came back at 95% — the strongest score of the week.",
        "Logged time on five assignments, which is enough for the planner to start estimating against your actual pace.",
      ],
      struggles: [
        "Two Chemistry assignments missed, worth 50 points combined.",
        "Chemistry dropped from 81.5% to 74.2% across two checks.",
        "Every logged item took longer than estimated — by about 45% on average.",
      ],
      adjustments: [
        "Start Chemistry first each evening rather than last, before the productive part of the night is gone.",
        "Add 40% to your own estimates until the calibration has more logs to work from.",
        "Book the Unit 4 test review across two sittings this week instead of the night before.",
      ],
      assignmentsCompleted: 6,
      assignmentsMissed: 2,
      minutesLogged: 400,
      provider: SEED_MARKER,
      model: "demo",
    },
  });

  // --- Sync history ---------------------------------------------------------
  await prisma.syncRun.create({
    data: {
      mode: "CANVAS_API",
      status: "SUCCESS",
      startedAt: new Date(Date.now() - 12 * 60_000),
      finishedAt: new Date(Date.now() - 11 * 60_000),
      coursesSynced: COURSES.length,
      assignmentsSynced: COURSES.reduce(
        (sum, course) => sum + course.assignments.length,
        0,
      ),
      announcementsSynced: 3,
    },
  });

  await prisma.syncRun.create({
    data: {
      mode: "GOOGLE_CALENDAR",
      status: "SUCCESS",
      startedAt: new Date(Date.now() - 11 * 60_000),
      finishedAt: new Date(Date.now() - 10 * 60_000),
      eventsCreated: 4,
      eventsUpdated: 2,
      eventsSkipped: 1,
    },
  });

  const counts = {
    courses: COURSES.length,
    assignments: COURSES.reduce((sum, c) => sum + c.assignments.length, 0),
    planTasks: planAssignments.length,
  };

  console.log(
    `Seeded ${counts.courses} classes, ${counts.assignments} assignments, a daily plan (${counts.planTasks} tasks), one digest, ${chemistryCards.length} flashcards and last week's retro.`,
  );
  console.log(`Plan id ${plan.id}.`);
  console.log(
    "Now run the struggles engine so the orb has something to read:\n" +
      "  curl -X POST 'http://localhost:5900/api/struggles/detect?explain=0'",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
