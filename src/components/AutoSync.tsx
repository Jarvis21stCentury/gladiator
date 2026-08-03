"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface AutoSyncProps {
  /** ISO timestamp of the last Canvas sync, or null if never synced. */
  lastSyncedAt: string | null;
  /** Trigger a refresh once the data is older than this. */
  staleAfterMinutes: number;
}

type State = "idle" | "syncing" | "done" | "error";

/**
 * Refreshes stale data when the dashboard is opened. On Vercel Hobby the cron
 * jobs only run twice a day, so without this the numbers on screen could be
 * hours old. The server throttles repeat calls, so a fast reload is cheap.
 */
export function AutoSync({ lastSyncedAt, staleAfterMinutes }: AutoSyncProps) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  // Effects run twice under React Strict Mode in dev; only sync once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;

    const ageMs = lastSyncedAt
      ? Date.now() - new Date(lastSyncedAt).getTime()
      : Number.POSITIVE_INFINITY;

    if (ageMs < staleAfterMinutes * 60_000) return;

    started.current = true;

    let cancelled = false;

    void (async () => {
      setState("syncing");

      try {
        const response = await fetch("/api/sync/auto", { method: "POST" });
        const body = await response.json().catch(() => ({}));

        if (cancelled) return;

        if (!response.ok) {
          setState("error");
          return;
        }

        setState("done");
        // Nothing changed on a throttled call — don't re-render for it.
        if (!body.skipped) router.refresh();
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lastSyncedAt, staleAfterMinutes, router]);

  if (state === "syncing") {
    return <span className="rubric">refreshing from canvas…</span>;
  }

  if (state === "error") {
    return <span className="rubric">background refresh failed</span>;
  }

  return null;
}
