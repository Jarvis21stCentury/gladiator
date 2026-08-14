"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Writes cards for one class from its nightly notes.
 *
 * Normally you press this once after a run of lessons; `force` rewrites cards
 * that already exist, which is the escape hatch for a night whose notes were
 * regenerated underneath them.
 */
export function CardGenerateButton({
  courseId,
  label,
  force = false,
}: {
  courseId: string;
  label: string;
  force?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);

    try {
      const params = new URLSearchParams({ courseId });
      if (force) params.set("force", "1");

      const response = await fetch(`/api/flashcards/generate?${params}`, {
        method: "POST",
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.error ?? "Could not write cards.");
        return;
      }

      const written = body.cardsWritten as number;
      const updated = body.cardsUpdated as number;

      /* Where the cards came from matters: read from the raw course material
         they are a rougher first pass than cards written from a distilled
         digest, and the student should know which they are looking at. */
      const raw = body.fromRawMaterial === true;

      setMessage(
        written === 0 && updated === 0
          ? raw
            ? "Nothing worth a card in the material collected so far."
            : "Nothing new to make cards from."
          : `${written} new card${written === 1 ? "" : "s"}${
              updated > 0 ? `, ${updated} rewritten` : ""
            }${raw ? " — from your course material." : "."}`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="control"
        data-active={force ? undefined : "true"}
      >
        {busy ? "Writing…" : label}
      </button>
      {message ? <span className="docket">{message}</span> : null}
    </span>
  );
}
