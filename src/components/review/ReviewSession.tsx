"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { gradeFlashcard } from "@/app/actions";
import { Plate } from "@/components/press/Plate";
import { Rule } from "@/components/press/Rule";
import type { ReviewCard } from "@/lib/flashcards/deck";
import {
  RATINGS,
  previewIntervals,
  schedule,
  type Rating,
} from "@/lib/flashcards/schedule";

/**
 * One sitting.
 *
 * The queue lives in the browser, not in the database. That matters for how the
 * session *feels*: "Again" has to put the card a few places later in the same
 * sitting, and waiting on a round trip to find that out would make every answer
 * feel like a page load. Grades are sent in the background and the next card is
 * drawn immediately; a failed send is surfaced but never blocks the review,
 * because the scheduling of one card is not worth interrupting a study session
 * over.
 *
 * Keyboard first. Space flips, 1–4 grade. Anyone reviewing forty cards is not
 * reaching for the mouse forty times, and the buttons carry their shortcut.
 */

/** How many cards later a forgotten card comes back within the same sitting. */
const REQUEUE_GAP = 4;

interface QueueItem extends ReviewCard {
  /** Bumped each time the card is re-queued, so React sees a new card. */
  attempt: number;
}

export function ReviewSession({
  courseId,
  courseName,
  cards,
}: {
  courseId: string;
  courseName: string;
  cards: ReviewCard[];
}) {
  const router = useRouter();

  const [queue, setQueue] = useState<QueueItem[]>(() =>
    cards.map((card) => ({ ...card, attempt: 0 })),
  );
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [again, setAgain] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Set in the effect below rather than at render: calling Date.now() during
  // render is impure, and the value is only ever read after the card is shown.
  const shownAt = useRef(0);
  const current = queue[0];

  // `now` is frozen for the session so every interval preview agrees with the
  // date the server will actually write, even across midnight.
  const sessionStart = useMemo(() => new Date(), []);

  const previews = useMemo(
    () => (current ? previewIntervals(current, sessionStart) : null),
    [current, sessionStart],
  );

  useEffect(() => {
    shownAt.current = Date.now();
  }, [current?.id, current?.attempt]);

  const grade = useCallback(
    (rating: Rating) => {
      if (!current) return;

      const elapsedMs = Date.now() - shownAt.current;
      const next = schedule(current, rating, sessionStart);

      setQueue((previous) => {
        const [head, ...rest] = previous;
        if (!head) return previous;

        if (rating === 1) {
          // Forgotten: back into the sitting, far enough away to be a real
          // second attempt rather than an echo of the answer you just read.
          const updated: QueueItem = {
            ...head,
            ...next,
            fresh: false,
            attempt: head.attempt + 1,
          };
          const at = Math.min(REQUEUE_GAP, rest.length);
          return [...rest.slice(0, at), updated, ...rest.slice(at)];
        }

        return rest;
      });

      setRevealed(false);
      setAnswered((n) => n + 1);
      if (rating === 1) setAgain((n) => n + 1);

      // Fire and forget. The queue has already moved on.
      void gradeFlashcard(current.id, rating, elapsedMs)
        .then((result) => {
          if (!result.ok) setError("A card could not be saved.");
        })
        .catch(() => setError("A card could not be saved."));
    },
    [current, sessionStart],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (event.code === "Space" || event.key === "Enter") {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else grade(3);
        return;
      }

      if (!revealed) return;

      const rating = Number(event.key);
      if (rating >= 1 && rating <= 4) {
        event.preventDefault();
        grade(rating as Rating);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, grade]);

  const total = cards.length;
  const done = total - queue.length;

  /* ---------------- Finished ---------------- */
  if (!current) {
    return (
      <div className="hang">
        <span aria-hidden="true" className="hidden lg:block" />
        <div>
          <Plate as="h2" className="display display--lg">
            Done for now
          </Plate>

          <p className="prose prose--lead mt-5 text-ink-soft">
            {answered} answer{answered === 1 ? "" : "s"} in {courseName}
            {again > 0
              ? `, ${again} of which you'd forgotten and saw again.`
              : ", none forgotten."}
          </p>

          <Rule className="my-9" />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="control"
              data-active="true"
              onClick={() => router.refresh()}
            >
              Check for more
            </button>
            <Link href="/review" className="control">
              All subjects
            </Link>
            <Link href={`/classes#course-${courseId}`} className="control">
              Back to {courseName}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Reviewing ---------------- */
  return (
    <div className="hang">
      <span aria-hidden="true" className="hidden lg:block" />

      <div>
        {/* Progress. A count, not a bar: you're being told how many are left,
            which is the only thing you want to know mid-session. */}
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <p className="docket">
            {String(done + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            {again > 0 ? ` · ${again} to see again` : ""}
          </p>
          <p className="rubric">
            {current.fresh
              ? "new card"
              : `seen ${current.repetitions}× · ${current.lapses} lapse${current.lapses === 1 ? "" : "s"}`}
          </p>
        </div>

        <Rule className="mt-4" />

        {/* The card. Sized so a question and its answer both sit in one view
            without the page jumping when the answer appears. */}
        <div className="flex min-h-[34vh] flex-col justify-center py-[var(--block)]">
          <p
            key={`${current.id}-${current.attempt}`}
            className="display display--md max-w-[26ch]"
          >
            {current.front}
          </p>

          {/*
            Deliberately not `data-press`. Those reveals are wired up by an
            IntersectionObserver when the page mounts, and this node does not
            exist yet at that point — so it would be observed by nothing and sit
            at its hidden initial state forever. An answer you are waiting for
            should appear the instant you ask for it anyway.
          */}
          {revealed ? (
            <div className="mt-9 motion-safe:animate-[reveal_220ms_var(--strike)]">
              <Rule animate={false} />
              <p className="prose prose--lead mt-6">{current.back}</p>
              {current.hint ? (
                <p className="docket mt-4">{current.hint}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <Rule animate={false} />

        {/* Grading */}
        <div className="mt-6">
          {!revealed ? (
            <button
              type="button"
              className="control"
              data-active="true"
              onClick={() => setRevealed(true)}
            >
              Show answer
              <span className="opacity-60">space</span>
            </button>
          ) : (
            <div className="flex flex-wrap gap-3">
              {RATINGS.map(({ rating, label, key }) => (
                <button
                  key={rating}
                  type="button"
                  className="control"
                  onClick={() => grade(rating)}
                  /*
                   * The two ends of the ladder flood their own signal ink
                   * rather than the accent: this is the one place in the
                   * product where pressing a button *is* the judgement, so the
                   * colour has to carry it. Both floods are dark enough to keep
                   * the default white label, but it is restated so a future
                   * change to --accent-ink cannot silently break them.
                   */
                  style={
                    rating === 1
                      ? ({
                          "--control-fill": "var(--flare)",
                          "--control-on": "#FFFFFF",
                        } as React.CSSProperties)
                      : rating === 4
                        ? ({
                            "--control-fill": "var(--jade)",
                            "--control-on": "#FFFFFF",
                          } as React.CSSProperties)
                        : undefined
                  }
                >
                  <span>{label}</span>
                  <span className="opacity-60">{previews?.[rating]}</span>
                  <span className="sr-only">shortcut {key}</span>
                </button>
              ))}
            </div>
          )}

          <p className="docket mt-5">
            {revealed
              ? "1 again · 2 hard · 3 good · 4 easy"
              : "Answer it in your head first, then reveal."}
          </p>

          {error ? (
            <p className="docket mt-3" style={{ color: "var(--flare)" }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
