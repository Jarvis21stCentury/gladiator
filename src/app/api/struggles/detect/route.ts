import { NextResponse } from "next/server";

import { runStruggleDetection } from "@/lib/struggles/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Run the struggles engine.
 *
 * Unauthenticated for the same reason as `/api/sync/auto` — the browser has no
 * secret to send and this app has no login. It is also cheap to abuse: the
 * rules are pure database arithmetic, and the one model call is skipped unless
 * a flag is new or its evidence changed, so pressing this repeatedly does
 * almost nothing.
 *
 * `?explain=0` skips the rewrite entirely, which is what the dashboard's
 * gap-filling path uses when it only needs the verdict to be correct.
 */
export async function POST(request: Request) {
  const explain = new URL(request.url).searchParams.get("explain") !== "0";

  try {
    const result = await runStruggleDetection({ explain });

    // A failed rewrite is not a failed detection — the flags are on record
    // either way, so this is a 200 with the error reported inside it.
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
