"use client";

import { useSyncExternalStore } from "react";

import { courseStyle } from "@/lib/courses/color";

/**
 * What you are supposed to be doing right now.
 *
 * The schedule answers "what does today look like". This answers the only
 * question a student actually opens the app to ask at 7pm, which is a different
 * question and deserves its own answer rather than making you scan a list of
 * times and compare them against a clock.
 *
 * ## Why the time is computed on the client
 *
 * "Now" is the one value a server cannot know. The server renders in UTC on a
 * deployment and the student is somewhere else, so a server-rendered "current
 * block" would be wrong by hours — and would then disagree with the browser at
 * hydration. So this renders a stable placeholder on the server and on the first
 * client paint, and fills in once mounted. The schedule below it is fully
 * server-rendered and never depends on this; nothing here is load-bearing.
 *
 * The clock is subscribed to with `useSyncExternalStore` rather than a
 * `setState` in an effect. It is genuinely an external source of truth, and the
 * hook gives the server render its own snapshot for free — which is exactly the
 * hydration-safety this needs. The snapshot is a *bucket number* rather than a
 * Date: `getSnapshot` must return something stable between calls or React
 * re-renders forever.
 *
 * It re-checks every 15 seconds, which is enough to move between blocks
 * promptly without waking the page constantly.
 */

const TICK_MS = 15_000;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

/** Whole ticks since the epoch — changes at most once every TICK_MS. */
const getSnapshot = () => Math.floor(Date.now() / TICK_MS);

/** 0 means "not on a client yet": the server has no meaningful clock here. */
const getServerSnapshot = () => 0;

interface NowBlock {
  id: string;
  kind: string;
  title: string;
  reason: string;
  /** ISO strings — Dates do not survive the server/client boundary intact. */
  startAt: string | null;
  endAt: string | null;
  done: boolean;
  courseName: string | null;
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

function label(kind: string): string {
  if (kind === "MEAL") return "Dinner";
  if (kind === "BREAK") return "On a break";
  return "Working on";
}

export function NowPanel({ blocks }: { blocks: NowBlock[] }) {
  const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const now = tick === 0 ? null : new Date(tick * TICK_MS);

  const timed = blocks.filter((block) => block.startAt && block.endAt);
  if (timed.length === 0) return null;

  if (!now) {
    // Reserves the panel's height so the page does not jump when it fills in.
    return (
      <div className="card p-3.5" aria-hidden="true">
        <p className="rubric">Right now</p>
        <p className="display display--md mt-1.5 opacity-0">—</p>
      </div>
    );
  }

  const current = timed.find(
    (block) => new Date(block.startAt!) <= now && now < new Date(block.endAt!),
  );
  const next = timed.find((block) => new Date(block.startAt!) > now);

  const minutesUntil = (iso: string) =>
    Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60_000));

  /* ---------- Nothing scheduled at this moment ---------- */
  if (!current) {
    const finished = !next;

    return (
      <div className="card p-3.5" role="status">
        <p className="rubric">Right now</p>
        <p className="display display--md mt-1.5">
          {finished ? "Done for today" : "Nothing scheduled yet"}
        </p>
        <p className="mt-1 text-[0.8125rem] text-ink-soft">
          {finished
            ? "Everything today's plan asked for is behind you."
            : `Next up: ${next!.title} at ${new Date(next!.startAt!).toLocaleTimeString([], TIME_FORMAT)}, in ${minutesUntil(next!.startAt!)} min.`}
        </p>
      </div>
    );
  }

  const start = new Date(current.startAt!);
  const end = new Date(current.endAt!);
  const total = Math.max(1, (end.getTime() - start.getTime()) / 60_000);
  const elapsed = (now.getTime() - start.getTime()) / 60_000;
  const left = Math.max(0, Math.ceil(total - elapsed));
  const progress = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const isWork = current.kind === "WORK";

  return (
    <div className="card p-3.5" role="status">
      <div className="flex items-baseline justify-between gap-4">
        <p className="rubric">{label(current.kind)}</p>
        <p className="docket text-[0.75rem]">
          until {end.toLocaleTimeString([], TIME_FORMAT)}
        </p>
      </div>

      <div className="mt-1.5 flex items-start gap-2.5">
        {isWork ? (
          <span
            className="chip mt-1"
            style={courseStyle(current.courseName)}
            aria-hidden="true"
          />
        ) : null}
        <p
          className="display display--md min-w-0"
          style={{ fontStyle: isWork ? undefined : "italic" }}
        >
          {current.title}
        </p>
      </div>

      {/* Only work needs explaining. "Eat properly" under the word Dinner is
          the kind of line that makes an interface feel like it is talking. */}
      {isWork ? (
        <p className="mt-1 text-[0.8125rem] text-ink-soft">{current.reason}</p>
      ) : null}

      {/* How much of this block is gone. A bar rather than a countdown clock:
          a ticking timer turns studying into a race against a number. */}
      <div
        className="mt-2.5 h-1 w-full overflow-hidden rounded-sm bg-rule"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${left} minutes left`}
      >
        <div
          className="h-full rounded-sm transition-[width] duration-500"
          style={{
            width: `${progress}%`,
            background: isWork ? "var(--accent)" : "var(--ink-faint)",
          }}
        />
      </div>

      <p className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 text-[0.75rem] text-ink-soft">
        <span>
          <span className="fig text-ink">{left}</span> min left
        </span>
        {next ? (
          <span className="truncate">
            then {next.title} at{" "}
            {new Date(next.startAt!).toLocaleTimeString([], TIME_FORMAT)}
          </span>
        ) : (
          <span>last block of the day</span>
        )}
      </p>
    </div>
  );
}
