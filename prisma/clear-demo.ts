/**
 * Remove the demo data, without putting it back.
 *
 * `npm run db:seed` wipes the demo rows *and rewrites them*, which is what you
 * want while developing and exactly what you do not want on the day you start
 * using this for real: you connect Canvas, sync your actual classes, and six
 * invented ones are still sitting alongside them.
 *
 * Only demo rows are touched. Demo courses are marked with a negative
 * `canvasId` (real Canvas ids are always positive) and their assignments,
 * grades and notes follow via the schema's cascades. Seed-written plans,
 * retros and flashcards carry `provider: "seed"`.
 *
 * Deliberately left alone: your routine, your saved Canvas/Google credentials,
 * and anything you added yourself against a real course.
 *
 * Pass `--dry` to see what it would remove without removing it. Deleting rows is
 * not undoable, so the safe version is one flag away rather than one flag
 * assumed.
 */
// Same first line as the seed: without it DATABASE_URL is undefined under tsx.
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const SEED_MARKER = "seed";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const dry = process.argv.includes("--dry");

  const demoCourses = await prisma.course.count({
    where: { canvasId: { lt: 0 } },
  });
  const demoAssignments = await prisma.assignment.count({
    where: { course: { canvasId: { lt: 0 } } },
  });

  if (dry) {
    const plans = await prisma.dailyPlan.count({ where: { provider: SEED_MARKER } });
    const retros = await prisma.weeklyRetro.count({ where: { provider: SEED_MARKER } });
    const cards = await prisma.flashcard.count({ where: { provider: SEED_MARKER } });
    const real = await prisma.course.count({ where: { canvasId: { gte: 0 } } });
    const routine = await prisma.routineBlock.count();
    const manual = await prisma.assignment.count({ where: { source: "MANUAL" } });

    console.log("Dry run — nothing deleted.\n");
    console.log(`Would remove: ${demoCourses} demo course(s) and their ${demoAssignments} assignment(s),`);
    console.log(`              ${plans} seed plan(s), ${retros} seed retro(s), ${cards} seed flashcard(s).`);
    console.log(`Would keep:   ${real} real course(s), ${routine} routine block(s), ${manual} task(s) you added,`);
    console.log("              and your saved Canvas/Google credentials.");
    return;
  }

  const [courses, plans, retros, cards] = await prisma.$transaction([
    prisma.course.deleteMany({ where: { canvasId: { lt: 0 } } }),
    prisma.dailyPlan.deleteMany({ where: { provider: SEED_MARKER } }),
    prisma.weeklyRetro.deleteMany({ where: { provider: SEED_MARKER } }),
    prisma.flashcard.deleteMany({ where: { provider: SEED_MARKER } }),
  ]);

  console.log(
    `Removed ${courses.count} demo course${courses.count === 1 ? "" : "s"} ` +
      `(of ${demoCourses} found), ${plans.count} plan(s), ${retros.count} retro(s), ` +
      `${cards.count} flashcard(s).`,
  );

  const remaining = await prisma.course.count();
  const routine = await prisma.routineBlock.count();
  console.log(
    `Left alone: ${remaining} real course(s), ${routine} routine block(s), and your saved credentials.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
