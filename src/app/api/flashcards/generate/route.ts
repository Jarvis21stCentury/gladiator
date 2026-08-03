import { NextResponse } from "next/server";

import { generateFlashcards } from "@/lib/flashcards/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Write (or rewrite) a class's cards from its nightly notes.
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
