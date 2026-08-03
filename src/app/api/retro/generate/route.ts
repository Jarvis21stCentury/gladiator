import { NextResponse } from "next/server";

import { generateWeeklyRetro, weekStartOf } from "@/lib/retro/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Write the weekly retro. Called from the retro page and from the Sunday
 * evening cron slot.
 *
 * `?week=YYYY-MM-DD` writes the retro for the week containing that date —
 * any day in the week works, it is snapped to the Monday.
 */
export async function POST(request: Request) {
  const raw = new URL(request.url).searchParams.get("week");

  let date = new Date();

  if (raw) {
    const parsed = new Date(`${raw}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: `Could not read the date "${raw}". Use YYYY-MM-DD.` },
        { status: 400 },
      );
    }
    date = parsed;
  }

  try {
    const result = await generateWeeklyRetro(date);
    return NextResponse.json({
      ...result,
      weekStart: weekStartOf(date).toISOString().slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
