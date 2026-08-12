import { NextResponse } from "next/server";

import { runHacSync } from "@/lib/sync/hac-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pull grades from HAC now. */
export async function POST() {
  const result = await runHacSync();
  return NextResponse.json(result, {
    status: result.status === "FAILED" ? 502 : 200,
  });
}
