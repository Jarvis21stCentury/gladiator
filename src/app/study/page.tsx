import Link from "next/link";

import { DigestGenerateButton } from "@/components/DigestGenerateButton";
import { TextbookUpload } from "@/components/TextbookUpload";
import { CardGenerateButton } from "@/components/review/CardGenerateButton";
import { FlashcardForm } from "@/components/review/FlashcardForm";
import { Docket } from "@/components/press/Docket";
import { PageHeader } from "@/components/press/PageHeader";
import { Plate } from "@/components/press/Plate";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import { courseStyle } from "@/lib/courses/color";
import { formatSchoolDay, parseSchoolDay } from "@/lib/digest/day";
import { getDigestForDay } from "@/lib/digest/generate";
import { getDeckSummaries, type DeckSummary } from "@/lib/flashcards/deck";
import { serial } from "@/lib/format";
import { STATUS_VAR } from "@/lib/status";

/**
 * Studying, in one place.
 *
 * This was two pages — Digest and Review — and they were two halves of one
 * loop that never met. Notes are written from the day's material; cards are
 * written from those notes; cards come back when they are due. A student who
 * wanted to *study* had to visit one page to read, notice a class had notes,
 * navigate to a second page, find the same class again, and press a button
 * there. Two navigation items for one activity, and the dependency between
 * them stated nowhere.
 *
 * ## How it is organised
 *
 * Action before reading, and that order is the design:
 *
 *   1. **Due now** — the cards waiting on you, per subject. What to *do*.
 *   2. **Tonight's notes** — the prose. What to *read*. Each class's notes
 *      carry their own card controls in the footer, so the "these notes can
 *      become cards" relationship is visible at the point it is true rather
 *      than on another screen.
 *   3. **Intake and method** — textbook pages, undistilled uploads, how the
 *      scheduling works. Setup and reference, folded away.
 *
 * The reading section keeps the single measure the digest always had. That is
 * the one rule from the old page worth defending: it is read tired, and putting
 * furniture between the reader and the words costs more here than the density
 * it buys.
 */

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  CANVAS_MODULE_ITEM: "Canvas",
  CANVAS_ANNOUNCEMENT: "Announcement",
  CANVAS_COURSEWORK: "Coursework page",
  TEXTBOOK_IMAGE: "Textbook photo",
  TEXTBOOK_PDF: "Textbook PDF",
};

function shiftDay(day: Date, days: number): string {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + days);
  return formatSchoolDay(next);
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The card controls that belong to one class, wherever that class appears. */
function DeckControls({ deck }: { deck: DeckSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {deck.due > 0 ? (
        <Link
          href={`/study/${deck.courseId}`}
          className="control"
          data-active="true"
        >
          Review {deck.due} card{deck.due === 1 ? "" : "s"}
        </Link>
      ) : null}

      {deck.uncardedNotes > 0 ? (
        <CardGenerateButton
          courseId={deck.courseId}
          label={`Make cards from ${deck.uncardedNotes} note${deck.uncardedNotes === 1 ? "" : "s"}`}
        />
      ) : null}

      {deck.due === 0 && deck.total > 0 ? (
        <Link href={`/study/${deck.courseId}`} className="control">
          {deck.total} card{deck.total === 1 ? "" : "s"}
        </Link>
      ) : null}

      <span className="docket text-[0.6875rem] opacity-70">
        {deck.total === 0
          ? "no cards yet"
          : [
              `${deck.total} card${deck.total === 1 ? "" : "s"}`,
              deck.fresh > 0 ? `${deck.fresh} never seen` : null,
              deck.due === 0 && deck.nextDueAt
                ? `next ${shortDate(deck.nextDueAt)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
      </span>
    </div>
  );
}

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; course?: string }>;
}) {
  const params = await searchParams;
  const day = parseSchoolDay(params.date ?? null);

  const [{ notes, pendingSources, courses, course, otherDay }, decks] =
    await Promise.all([
      getDigestForDay(day, params.course || undefined),
      getDeckSummaries(),
    ]);

  const dateParam = formatSchoolDay(day);
  const readableDate = day.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const deckByCourse = new Map(decks.map((deck) => [deck.courseId, deck]));

  const due = decks
    .filter((deck) => deck.due > 0)
    .sort((a, b) => b.due - a.due);
  const totalDue = due.reduce((sum, deck) => sum + deck.due, 0);
  const totalCards = decks.reduce((sum, deck) => sum + deck.total, 0);

  // Classes with notes waiting to become cards. The whole reason the two pages
  // had to be one: this list is derived from digest data and acted on with
  // review controls, and neither page could see both.
  const readyToCard = decks.filter((deck) => deck.uncardedNotes > 0);

  const pendingByCourse = new Map<string, typeof pendingSources>();
  for (const source of pendingSources) {
    const bucket = pendingByCourse.get(source.course.name) ?? [];
    bucket.push(source);
    pendingByCourse.set(source.course.name, bucket);
  }

  const withCourse = (date: string) =>
    course ? `/study?date=${date}&course=${course.id}` : `/study?date=${date}`;

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow={course ? `${course.name} · ${readableDate}` : readableDate}
        title="Study"
        purpose="Tonight's notes, and the cards that came out of them."
        meta={
          <p
            className="rubric"
            style={totalDue > 0 ? { color: STATUS_VAR.warming } : undefined}
          >
            {totalDue > 0
              ? `${totalDue} card${totalDue === 1 ? "" : "s"} due`
              : "nothing due"}
          </p>
        }
      />

      {/* ===================== DUE NOW ===================== */}
      <section className="band mt-[var(--section)] py-[var(--section)]">
        <div className="sheet">
          <SectionHead
            id="due"
            rubric="Due"
            title="Due now"
            description="Cards ready for you, per subject."
            aside={
              <span className="docket">
                {totalCards} card{totalCards === 1 ? "" : "s"} in all
              </span>
            }
          />

          {due.length === 0 ? (
            <p className="docket">
              {totalCards === 0
                ? "No cards yet — they're written from the notes below."
                : "Nothing due. Everything you have is scheduled ahead."}
            </p>
          ) : (
            <Docket>
              {due.map((deck) => (
                <li
                  key={deck.courseId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule/70 py-2.5 last:border-b-0"
                >
                  <span
                    className="dot"
                    style={courseStyle(deck.courseName)}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.875rem]">
                    {deck.courseName}
                  </span>
                  <span className="docket text-[0.6875rem] opacity-70">
                    {deck.fresh > 0 ? `${deck.fresh} new` : ""}
                  </span>
                  <Link
                    href={`/study/${deck.courseId}`}
                    className="control"
                    data-active="true"
                  >
                    Review {deck.due}
                  </Link>
                </li>
              ))}
            </Docket>
          )}

          {/*
            Every class and its next move, always rendered.

            This block used to appear only when some class had notes waiting —
            which meant that with no notes at all, there was no way anywhere in
            the product to make a flashcard, at exactly the moment a new student
            goes looking for one. A row that says "build notes first" is a
            worse-looking page and a far better one to use.
          */}
          <div className="mt-[var(--block)]">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <p className="rubric">Your cards</p>
              <FlashcardForm courses={courses} />
            </div>

            <Docket>
              {decks.map((deck) => (
                <li
                  key={deck.courseId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule/70 py-2.5 last:border-b-0"
                >
                  <span
                    className="dot"
                    style={courseStyle(deck.courseName)}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.875rem]">
                    {deck.courseName}
                  </span>

                  <span className="docket shrink-0 text-[0.6875rem] opacity-70">
                    {deck.total > 0
                      ? `${deck.total} card${deck.total === 1 ? "" : "s"}`
                      : "no cards"}
                  </span>

                  {/* Generation is offered whether or not notes exist. With
                      notes it reads those; without, it reads the raw course
                      material the ingest collected. Gating this on
                      `uncardedNotes > 0` is what made "make cards for me"
                      invisible on a fresh install. */}
                  <CardGenerateButton
                    courseId={deck.courseId}
                    label={
                      deck.uncardedNotes > 0
                        ? `Make from ${deck.uncardedNotes} note${deck.uncardedNotes === 1 ? "" : "s"}`
                        : "Make cards for me"
                    }
                  />
                  <FlashcardForm courses={courses} courseId={deck.courseId} />
                </li>
              ))}
            </Docket>

            {readyToCard.length === 0 ? (
              <p className="docket mt-3 max-w-[62ch] leading-relaxed">
                Cards are also written for you from each night&apos;s notes —
                build a digest below and a &ldquo;make from N notes&rdquo; button
                appears on every class that has them.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ===================== TONIGHT'S NOTES ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="notes"
          rubric="Notes"
          title="Tonight's notes"
          description="Key points per class, written from the day's material."
          aside={
            <nav className="flex flex-wrap items-center gap-2">
              <Link href={withCourse(shiftDay(day, -1))} className="control">
                ← Prev
              </Link>
              <Link
                href={course ? `/study?course=${course.id}` : "/study"}
                className="control"
              >
                Today
              </Link>
              <Link href={withCourse(shiftDay(day, 1))} className="control">
                Next →
              </Link>
              {course ? (
                <Link href={`/study?date=${dateParam}`} className="control">
                  All classes
                </Link>
              ) : null}
            </nav>
          }
        />

        <div className="mb-[var(--block)]">
          <DigestGenerateButton
            date={dateParam}
            label={
              notes.length === 0 ? "Build tonight's notes" : "Pick up new material"
            }
          />
        </div>

        {notes.length === 0 ? (
          <p className="prose text-ink-soft">
            {course && otherDay ? (
              <>
                Nothing for {course.name} on this day. Its most recent notes are
                from{" "}
                <Link
                  href={`/study?date=${formatSchoolDay(otherDay)}&course=${course.id}`}
                  className="link"
                >
                  {otherDay.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </Link>
                .
              </>
            ) : course ? (
              <>No notes for {course.name} yet.</>
            ) : (
              "Canvas content is pulled automatically each evening. Add textbook pages below if you want them included."
            )}
          </p>
        ) : null}

        <div className="flex flex-col gap-[var(--section)]">
          {notes.map((note, noteIndex) => {
            const pending = pendingByCourse.get(note.course.name) ?? [];
            const deck = deckByCourse.get(note.course.id);

            return (
              <article key={note.id} id={`class-${note.course.id}`} className="scroll-mt-20">
                <Rule />

                <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="dot"
                      style={courseStyle(note.course.name)}
                      aria-hidden="true"
                    />
                    <Plate as="h3" className="display display--md plate--fit min-w-0">
                      {note.course.name}
                    </Plate>
                  </div>

                  <p className="rubric">
                    {note.sources.length > 0
                      ? note.sources
                          .map(
                            (source) =>
                              SOURCE_LABELS[source.kind] ?? source.kind,
                          )
                          // One label per kind: three module items is still
                          // "Canvas", and printing it three times said nothing.
                          .filter(
                            (label, index, all) => all.indexOf(label) === index,
                          )
                          .join(" · ")
                      : (note.rawInputRef ?? "unknown source")}
                  </p>
                </div>

                {pending.length > 0 ? (
                  <p className="docket mt-3" style={{ color: STATUS_VAR.warming }}>
                    {pending.length} newer upload
                    {pending.length === 1 ? "" : "s"} not yet included.
                  </p>
                ) : null}

                {/* The one measure. Nothing between the reader and the words —
                    this is the half of the page that gets read at 11pm. */}
                <p className="prose prose--lead mt-6">{note.generatedSummary}</p>

                {note.keyPoints.length === 0 ? (
                  <p className="docket mt-6">No key points were extracted.</p>
                ) : (
                  <Docket as="ol" className="mt-6">
                    {note.keyPoints.map((point, index) => (
                      <li
                        key={`${note.id}-${index}`}
                        className="flex gap-4 border-b border-rule/70 py-3 last:border-b-0"
                      >
                        <span className="docket shrink-0 pt-1">
                          {serial(index + 1)}
                        </span>
                        <p className="prose text-[0.95rem]">{point}</p>
                      </li>
                    ))}
                  </Docket>
                )}

                {/* Cards, at the foot of the notes they are made from. */}
                {deck ? (
                  <div className="mt-5 border-t border-rule pt-4">
                    <DeckControls deck={deck} />
                  </div>
                ) : null}

                {noteIndex === notes.length - 1 ? (
                  <div className="mt-[var(--block)]">
                    <DigestGenerateButton
                      date={dateParam}
                      force
                      label="Rewrite all notes for this day"
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {/* ===================== INTAKE AND METHOD ===================== */}
      <section className="sheet mt-[var(--section)]">
        {pendingSources.length > 0 ? (
          <div className="mb-[var(--block)]">
            <p className="rubric mb-2" style={{ color: STATUS_VAR.warming }}>
              {pendingSources.length} upload
              {pendingSources.length === 1 ? "" : "s"} not yet distilled
            </p>
            <Docket>
              {pendingSources.map((source) => (
                <li
                  key={source.id}
                  className="flex flex-wrap items-baseline gap-x-4 border-b border-rule/70 py-2.5 last:border-b-0"
                >
                  <span className="text-[0.875rem]">{source.course.name}</span>
                  <span className="rubric">
                    {SOURCE_LABELS[source.kind] ?? source.kind}
                  </span>
                  <span className="docket">{source.label}</span>
                </li>
              ))}
            </Docket>
          </div>
        ) : null}

        <details className="disclosure border-t border-rule">
          <summary>Add textbook pages</summary>
          <div className="pb-2 pt-4">
            <p className="prose mb-6 max-w-[56ch] text-[0.95rem] text-ink-soft">
              Canvas content is picked up automatically; textbook pages are not.
              Photograph a page or attach a PDF and the text is folded into
              tonight&apos;s notes. Only the text is kept.
            </p>
            <TextbookUpload courses={courses} date={dateParam} />
          </div>
        </details>

        <details className="disclosure border-t border-rule">
          <summary>How the scheduling works</summary>
          <div className="grid gap-x-10 gap-y-6 pb-2 pt-4 sm:grid-cols-2">
            {[
              {
                label: "Again",
                body: "You'd forgotten it. The card comes back later in the same sitting, and its gap resets.",
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
              <div key={row.label}>
                <p className="rubric">{row.label}</p>
                <p className="prose mt-1.5 text-[0.9rem]">{row.body}</p>
              </div>
            ))}

            <p className="prose text-[0.9rem] text-ink-soft sm:col-span-2">
              Cards you keep failing come back more often; cards you always know
              drift out to months apart. Rewriting a deck never resets that
              history — the questions change, the schedule stays.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
