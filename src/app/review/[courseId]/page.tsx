import Link from "next/link";
import { notFound } from "next/navigation";

import { Rule } from "@/components/press/Rule";
import { ReviewSession } from "@/components/review/ReviewSession";
import { getDeckSummary, getDueCards } from "@/lib/flashcards/deck";

/**
 * One subject's sitting.
 *
 * The only page in the product with a compact header rather than the full
 * masthead-and-contents treatment, and the only one that deserves it: every
 * other screen is for scanning, this is the one you are meant to be *inside*.
 * The first build gave it the standard header and the card landed below the
 * fold — half the screen spent restating what you clicked to get here.
 *
 * So: one line of context, the controls out of the way, and the question high
 * enough that the answer and the grading buttons share the same view.
 */

export const dynamic = "force-dynamic";

export default async function ReviewSessionPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;

  const [deck, cards] = await Promise.all([
    getDeckSummary(courseId),
    getDueCards(courseId),
  ]);

  if (!deck) notFound();

  return (
    <main className="flex-1">
      <section className="sheet pt-[var(--block)]">
        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
            <p className="docket">
              Reviewing{" "}
              <span className="text-ink">{deck.courseName}</span> ·{" "}
              {deck.total} card{deck.total === 1 ? "" : "s"} in this deck
            </p>

            <nav className="flex flex-wrap items-center gap-2">
              <Link href="/review" className="control">
                ← All subjects
              </Link>
              <Link href={`/classes#course-${courseId}`} className="control">
                The class
              </Link>
            </nav>
          </div>
        </div>

        <Rule weight="heavy" className="mt-4" />
      </section>

      <section className="sheet mt-[var(--block)]">
        {cards.length > 0 ? (
          <ReviewSession
            courseId={courseId}
            courseName={deck.courseName}
            cards={cards}
          />
        ) : (
          <div className="hang">
            <span aria-hidden="true" className="hidden lg:block" />
            <div>
              <p className="prose prose--lead">
                {deck.total === 0
                  ? "This subject has no cards yet."
                  : deck.nextDueAt
                    ? `Nothing due. The next card comes up on ${deck.nextDueAt.toLocaleDateString(
                        undefined,
                        { weekday: "long", month: "long", day: "numeric" },
                      )}.`
                    : "Everything here is answered."}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/review" className="control" data-active="true">
                  Pick another subject
                </Link>
                {deck.total === 0 ? (
                  <Link href="/digest" data-slip="" className="control">
                    Open the digest
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
