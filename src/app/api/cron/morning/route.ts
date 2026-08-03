import { NextResponse } from "next/server";

import { generateDailyPlan } from "@/lib/planner/daily-plan";
import { runCanvasSync } from "@/lib/sync/canvas-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The morning cron slot, composed so Vercel Hobby's two-cron limit is enough:
 * pull Canvas, then build today's plan from what just landed.
 *
 * The Google Calendar push deliberately runs in the evening slot instead. It is
 * the slowest step (one API call per assignment) and stacking it in front of an
 * LLM call risks blowing the 60s Hobby function ceiling — and a timeout here
 * would cost the daily plan, which is the part that has to exist by morning.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  let failed = false;

  const canvas = await runCanvasSync();
  results.canvas = canvas;
  if (canvas.status === "FAILED") failed = true;

  // Plan from whatever Canvas data exists, even if this morning's pull failed —
  // a plan built on yesterday's data beats no plan at all.
  try {
    results.dailyPlan = await generateDailyPlan();
  } catch (error) {
    results.dailyPlan = {
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
    failed = true;
  }

  return NextResponse.json(results, { status: failed ? 502 : 200 });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
