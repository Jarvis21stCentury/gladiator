import { NextResponse } from "next/server";

import { ingestCanvasContent } from "@/lib/digest/ingest-canvas";
import { generateFlashcards } from "@/lib/flashcards/generate";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Write (or rewrite) a class's cards.
 *
 * Cards come from the nightly notes when they exist and straight from the raw
 * course material when they don't. If neither exists yet, this collects the
 * material first — the Canvas ingest is pure fetching and costs nothing, and
 * without it a student's first press of "make cards" did nothing at all,
 * silently, because there was no material to read.
 *
 * Unauthenticated for the same reason as the digest endpoint: the browser has
 * no secret to send and this app has no login. It is self-limiting in the same
 * way too — a night's notes that already has cards is skipped without a model
 * call, so pressing the button twice costs nothing unless `force` is set.
 */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const courseId = params.get("courseId");
  const force = params.get("force") === "1";

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required." }, { status: 400 });
  }

  try {
    /*
     * No material at all — go and get some before giving up. This is the whole
     * difference between "make cards for me" working on the first press and
     * only working after a week of nightly digests have accumulated.
     */
    const material = await prisma.digestSource.count({ where: { courseId } });
    if (material === 0) await ingestCanvasContent();

    const result = await generateFlashcards({ courseId, force });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
