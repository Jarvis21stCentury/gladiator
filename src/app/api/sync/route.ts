import { NextResponse } from "next/server";

import { runCanvasSync } from "@/lib/sync/canvas-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual sync trigger. Vercel Cron will POST here later, which is why this is a
 * route handler rather than a server action.
 *
 * There is no user auth in this app by design. SYNC_SECRET is not a login — it
 * just stops a public URL from letting anyone burn Canvas rate limit. It is
 * enforced only when set, so local development needs no setup.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret) return true;

  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runCanvasSync();
    return NextResponse.json(result, {
      status: result.status === "FAILED" ? 502 : 200,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
