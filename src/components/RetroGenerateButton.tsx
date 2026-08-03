"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Writes (or rewrites) the retro for a week. Normally the Sunday evening cron
 * does this; the button exists for the weeks that cron never ran for, and for
 * regenerating one after a late sync changed the facts underneath it.
 */
export function RetroGenerateButton({
  week,
  label,
}: {
  /** `YYYY-MM-DD` — any day inside the week. */
  week: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/retro/generate?week=${week}`, {
        method: "POST",
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.error ?? "Retro failed.");
        return;
      }

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
        data-active="true"
      >
        {busy ? "Writing…" : label}
      </button>
      {message ? <span className="docket">{message}</span> : null}
    </span>
  );
}
