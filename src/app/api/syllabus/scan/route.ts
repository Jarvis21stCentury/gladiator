import { NextResponse } from "next/server";

import { ingestLinkedSchedules } from "@/lib/syllabus/ingest-linked";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scan every Canvas class for a linked assessment plan or syllabus and read the
 * dates out of it.
 *
 * A route rather than a server action because it is slow, fallible per-class,
 * and returns a report the UI shows — the same shape as the digest endpoint.
 *
 * `?force=1` re-reads documents already parsed. Off by default so an unattended
 * run does not spend a model call per class per night re-learning the same
 * dates; on when the student knows a plan has changed.
 */
export async function POST(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    return NextResponse.json(await ingestLinkedSchedules({ force }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
