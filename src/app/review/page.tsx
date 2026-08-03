import Link from "next/link";

import { CardGenerateButton } from "@/components/review/CardGenerateButton";
import { Figure } from "@/components/press/Figure";
import { PageHeader } from "@/components/press/PageHeader";
import { Plate } from "@/components/press/Plate";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import { getDeckSummaries } from "@/lib/flashcards/deck";
import { STATUS_VAR } from "@/lib/status";

/**
 * Pick a subject to review.
 *
 * Deliberately one screen per subject rather than one mixed queue across all
 * classes: revision is subject-shaped. You sit down to do chemistry, not to do
 * "twelve cards". A mixed queue is also how a session stops feeling finishable.
 */

export const dynamic = "force-dynamic";

export default async function ReviewIndexPage() {
  const decks = await getDeckSummaries();

  const totalDue = decks.reduce((sum, deck) => sum + deck.due, 0);
  const totalCards = decks.reduce((sum, deck) => sum + deck.total, 0);
  const withCards = decks.filter((deck) => deck.total > 0);
  const withoutCards = decks.filter((deck) => deck.total === 0);

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow={`${totalCards} card${totalCards === 1 ? "" : "s"} across ${withCards.length} subject${withCards.length === 1 ? "" : "s"}`}
        title="Review"
        purpose="Flashcards written from your nightly notes, scheduled so you see a card again just before you'd forget it."
        meta={
          <p className="rubric" style={totalDue > 0 ? { color: STATUS_VAR.warming } : undefined}>
            {totalDue > 0 ? `${totalDue} due now` : "nothing due"}
          </p>
        }
        contents={[
          { id: "subjects", label: "Pick a subject" },
          ...(withoutCards.length > 0
            ? [{ id: "make", label: "Make cards" }]
            : []),
          { id: "how", label: "How the scheduling works" },
        ]}
      />

      {/* ===================== 01 · SUBJECTS ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="subjects"
          serial="01"
          rubric="Decks"
          title="Pick a subject"
          description="One sitting per subject. The number is how many cards are ready for you right now."
          hint={totalDue > 0 ? "Start with whichever is furthest behind." : undefined}
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />

          {withCards.length === 0 ? (
            <p className="prose text-ink-soft">
              No cards yet. They&apos;re written from the key points in your
              nightly digest, so make some below once a class has a few nights of
              notes.
            </p>
          ) : (
            <div className="flex flex-col">
              {withCards.map((deck) => {
                const ready = deck.due > 0;

                return (
                  <article
                    key={deck.courseId}
                    className="border-t border-rule py-8 first:border-t-0 first:pt-0"
                    data-advance=""
                  >
                    <div className="grid gap-x-12 gap-y-6 lg:grid-cols-12">
                      <div className="lg:col-span-6">
                        <Plate as="h3" className="display display--md">
                          {deck.courseName}
                        </Plate>
                        <p className="docket mt-3">
                          {deck.total} card{deck.total === 1 ? "" : "s"}
                          {deck.fresh > 0 ? ` · ${deck.fresh} never seen` : ""}
                          {!ready && deck.nextDueAt
                            ? ` · next on ${deck.nextDueAt.toLocaleDateString(undefined, {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}`
                            : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-10 lg:col-span-3">
                        <Figure
                          label="Due now"
                          value={String(deck.due)}
                          tally={{ to: deck.due }}
                          level={ready ? "warming" : undefined}
                          size="lg"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3 lg:col-span-3 lg:justify-end">
                        {ready ? (
                          <Link
                            href={`/review/${deck.courseId}`}
                            className="control"
                            data-active="true"
                          >
                            Review {deck.due}
                          </Link>
                        ) : (
                          <span className="docket">nothing due</span>
                        )}
                        {deck.uncardedNotes > 0 ? (
                          <CardGenerateButton
                            courseId={deck.courseId}
                            label={`Make cards from ${deck.uncardedNotes} note${deck.uncardedNotes === 1 ? "" : "s"}`}
                          />
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ===================== 02 · MAKE CARDS ===================== */}
      {withoutCards.length > 0 ? (
        <section className="band mt-[var(--section)] py-[var(--section)]">
          <div className="sheet">
            <SectionHead
              id="make"
              serial="02"
              rubric="Generate"
              title="Make cards"
              description="These classes have no cards yet. Each one is written from a night's key points in the digest, so a class needs notes before it can have cards."
              size="md"
            />

            <div className="hang">
              <span aria-hidden="true" className="hidden lg:block" />
              <div className="flex flex-col">
                {withoutCards.map((deck) => (
                  <div
                    key={deck.courseId}
                    className="flex flex-wrap items-center justify-between gap-4 border-t border-rule py-5 first:border-t-0 first:pt-0"
                    data-advance=""
                  >
                    <div>
                      <p className="text-[1.05rem]">{deck.courseName}</p>
                      <p className="docket mt-1">
                        {deck.uncardedNotes > 0
                          ? `${deck.uncardedNotes} night${deck.uncardedNotes === 1 ? "" : "s"} of notes ready`
                          : "no notes yet — run a digest first"}
                      </p>
                    </div>

                    {deck.uncardedNotes > 0 ? (
                      <CardGenerateButton
                        courseId={deck.courseId}
                        label="Make cards"
                      />
                    ) : (
                      <Link href="/digest" data-slip="" className="control">
                        Open the digest
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ===================== 03 · HOW IT WORKS ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="how"
          serial={withoutCards.length > 0 ? "03" : "02"}
          rubric="Method"
          title="How the scheduling works"
          description="You grade each card on how well you knew it, and that decides when it comes back."
          size="md"
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />
          <div>
          <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {[
              {
                label: "Again",
                body: "You'd forgotten it. The card comes back a few cards later in the same sitting, and its gap resets.",
              },
              {
                label: "Hard",
                body: "You got there, slowly. The gap grows, but more slowly than usual.",
              },
              {
                label: "Good",
                body: "You knew it. The gap grows by the card's own ease — 1 day, then 6, then multiplying.",
              },
              {
                label: "Easy",
                body: "Instant. The gap jumps, and the card gets easier still next time.",
              },
            ].map((row) => (
              <div key={row.label} data-press="">
                <Rule />
                <p className="rubric mt-4">{row.label}</p>
                <p className="prose mt-2 text-[0.95rem]">{row.body}</p>
              </div>
            ))}
          </div>

          <p className="prose mt-[var(--block)] text-[0.95rem] text-ink-soft">
            Cards you keep failing get shown more often; cards you always know
            drift out to months apart. Rewriting a deck never resets that history
            — the questions change, the schedule stays.
          </p>
          </div>
        </div>
      </section>
    </main>
  );
}
