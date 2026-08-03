import { NextResponse } from "next/server";

import { parseSchoolDay } from "@/lib/digest/day";
import { generateDigest } from "@/lib/digest/generate";
import { ingestCanvasContent } from "@/lib/digest/ingest-canvas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Build (or rebuild) the digest for a day. Called from the digest page, and by
 * the evening cron via `/api/cron/evening`.
 *
 * Unauthenticated for the same reason as `/api/sync/auto`: the browser has no
 * secret to send and this app has no login. Unlike that endpoint there is no
 * time throttle, because the work is naturally self-limiting — a class whose
 * note is already written and has no new material is skipped without a model
 * call, so repeat presses cost nothing.
 */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  // Normalised once here; everything downstream takes the day as-is.
  const day = parseSchoolDay(params.get("date"));
  const force = params.get("force") === "1";
  const skipIngest = params.get("ingest") === "0";

  try {
    const ingest = skipIngest ? null : await ingestCanvasContent(day);
    const digest = await generateDigest({ day, force });

    return NextResponse.json({ ingest, digest });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
