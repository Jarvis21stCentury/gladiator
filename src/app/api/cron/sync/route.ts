import { NextResponse } from "next/server";

import { runCalendarSync } from "@/lib/sync/calendar-sync";
import { runCanvasSync } from "@/lib/sync/canvas-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled entry point (see vercel.json). Vercel Cron issues a GET and, when
 * CRON_SECRET is set on the project, attaches `Authorization: Bearer <secret>`.
 * POST is accepted too so the same job can be kicked off by hand.
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

  const only = new URL(request.url).searchParams.get("only");
  const results: Record<string, unknown> = {};
  let failed = false;

  if (only !== "calendar") {
    const canvas = await runCanvasSync();
    results.canvas = canvas;
    if (canvas.status === "FAILED") failed = true;
  }

  // Calendar runs second: it pushes whatever Canvas just landed. A missing
  // Google connection is reported, not thrown — Canvas ingestion still succeeded.
  if (only !== "canvas") {
    try {
      const calendar = await runCalendarSync();
      results.calendar = calendar;
      if (calendar.status === "FAILED") failed = true;
    } catch (error) {
      results.calendar = {
        status: "SKIPPED",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return NextResponse.json(results, { status: failed ? 502 : 200 });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
