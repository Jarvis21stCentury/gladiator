import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { runStruggleDetection } from "@/lib/struggles/engine";
import { runCalendarSync } from "@/lib/sync/calendar-sync";
import { runCanvasSync } from "@/lib/sync/canvas-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Don't re-sync if a run started within this many minutes. */
const DEFAULT_MIN_INTERVAL_MINUTES = 10;

/** Treat a RUNNING row younger than this as a sync still in flight. */
const IN_FLIGHT_MINUTES = 5;

/**
 * Opening the app is the trigger.
 *
 * On Hobby the crons only fire twice a day, so this fills the gap: the dashboard
 * calls it on load and the data refreshes when the user actually looks at it,
 * which suits a tool meant to open in two seconds.
 *
 * Deliberately unauthenticated — the browser has no secret to send, and this app
 * has no login by design. What makes that safe is the server-side throttle
 * below: a caller who hammers this endpoint gets `skipped` responses and never
 * reaches Canvas or Google, so it cannot be used to burn API rate limit.
 */
function minIntervalMinutes(): number {
  const raw = Number(process.env.AUTO_SYNC_MIN_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_INTERVAL_MINUTES;
}

export async function POST() {
  const lastCanvasRun = await prisma.syncRun.findFirst({
    where: { mode: { in: ["CANVAS_API", "ICAL_FALLBACK"] } },
    orderBy: { startedAt: "desc" },
  });

  if (lastCanvasRun) {
    const ageMs = Date.now() - lastCanvasRun.startedAt.getTime();

    // Another request is already syncing — don't start a second one alongside it.
    if (
      lastCanvasRun.status === "RUNNING" &&
      ageMs < IN_FLIGHT_MINUTES * 60_000
    ) {
      return NextResponse.json({
        skipped: true,
        reason: "A sync is already running.",
        lastSyncedAt: lastCanvasRun.startedAt,
      });
    }

    if (ageMs < minIntervalMinutes() * 60_000) {
      return NextResponse.json({
        skipped: true,
        reason: `Synced ${Math.round(ageMs / 60_000)} minute(s) ago.`,
        lastSyncedAt: lastCanvasRun.startedAt,
      });
    }
  }

  const results: Record<string, unknown> = { skipped: false };

  const canvas = await runCanvasSync();
  results.canvas = canvas;

  // Keeps Google Calendar current between the two daily cron runs.
  try {
    results.calendar = await runCalendarSync();
  } catch (error) {
    results.calendar = {
      status: "SKIPPED",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Re-detect struggles against the data that just landed, or the verdict would be
  // describing the previous sync. `explain: false` keeps this free — the prose
  // rewrite is the evening cron's job, and the deterministic sentence is
  // already correct in the meantime.
  try {
    results.struggles = await runStruggleDetection({ explain: false });
  } catch (error) {
    results.struggles = {
      status: "SKIPPED",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return NextResponse.json(results, {
    status: canvas.status === "FAILED" ? 502 : 200,
  });
}
