"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SyncButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setIsSyncing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.error ?? `Sync failed (HTTP ${response.status}).`);
      } else {
        setMessage(
          `Synced ${body.coursesSynced} courses, ${body.assignmentsSynced} assignments.`,
        );
        startTransition(() => router.refresh());
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSyncing(false);
    }
  }

  const busy = isSyncing || isPending;

  return (
    <span className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={sync} disabled={busy} className="control">
        {busy ? "Syncing…" : "Sync Canvas"}
      </button>
      {message ? (
        <span className="docket">{message}</span>
      ) : null}
    </span>
  );
}
