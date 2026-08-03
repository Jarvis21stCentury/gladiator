import { NextResponse } from "next/server";

import { generateDailyPlan } from "@/lib/planner/daily-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Morning job (see vercel.json). Runs after the school-hours sync has started,
 * so the plan is built from fresh Canvas data rather than yesterday's.
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

  try {
    return NextResponse.json(await generateDailyPlan());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
