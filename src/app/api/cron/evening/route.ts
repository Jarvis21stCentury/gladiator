import { NextResponse } from "next/server";

import { generateDigest } from "@/lib/digest/generate";
import { ingestCanvasContent } from "@/lib/digest/ingest-canvas";
import { generateWeeklyRetro } from "@/lib/retro/weekly";
import { runStruggleDetection } from "@/lib/struggles/engine";
import { runCalendarSync } from "@/lib/sync/calendar-sync";
import { runCanvasSync } from "@/lib/sync/canvas-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The evening cron slot — the second and last one Vercel Hobby allows.
 *
 * End of the school day: pull Canvas, push the calendar, then distil the day
 * into notes. The digest runs last and under a time budget, because it is the
 * only step that can't be finished in a fixed number of calls (one model call
 * per class). Anything it doesn't reach is picked up when the digest page is
 * opened, which is the same gap-filling pattern the dashboard uses.
 */

/** Leaves headroom inside the 60s Hobby ceiling for the steps before it. */
const DIGEST_BUDGET_MS = 35_000;

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

  try {
    results.calendar = await runCalendarSync();
  } catch (error) {
    results.calendar = {
      status: "SKIPPED",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Struggle detection runs before the digest and ahead of the time budget: it
  // is the input to the front page's verdict, it is mostly database arithmetic, and
  // its single model call is skipped unless a flag actually changed.
  try {
    results.struggles = await runStruggleDetection();
  } catch (error) {
    results.struggles = {
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Sunday evening closes the week out. Any other day this is skipped, so the
  // retro is written once against a finished week rather than rewritten nightly.
  if (new Date().getDay() === 0) {
    try {
      results.retro = await generateWeeklyRetro();
    } catch (error) {
      results.retro = {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Module content and announcements first, then distil what landed.
  try {
    results.ingest = await ingestCanvasContent();
    results.digest = await generateDigest({ budgetMs: DIGEST_BUDGET_MS });
  } catch (error) {
    results.digest = {
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
