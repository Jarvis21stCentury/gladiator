"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

interface CanvasStatus {
  connected: boolean;
  icalOnly: boolean;
  baseUrl: string | null;
  tokenHint: string | null;
  fromEnv: boolean;
}

/**
 * Sync Canvas — and connect it first, if it isn't.
 *
 * The button used to assume credentials existed. When they didn't, pressing it
 * returned "No Canvas credentials configured. Set CANVAS_BASE_URL +
 * CANVAS_TOKEN…", which is an instruction to go and edit a file on a server —
 * a dead end for the person the app is for.
 *
 * Now an unconnected app offers the form instead. The token is checked against
 * the real Canvas before it is stored, so a wrong address, an expired token and
 * a school that has disabled personal tokens each produce their own message
 * rather than one failure later during a sync.
 *
 * The token is write-only from the browser's side: the status endpoint returns
 * its last four characters and nothing else, and this component never holds it
 * after the request that saved it.
 */
export function SyncButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CanvasStatus | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/canvas/connect")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data as CanvasStatus);
      })
      .catch(() => {
        /* Status is an enhancement; the sync button still works without it. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function sync() {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? `Sync failed (HTTP ${response.status}).`);
        // The overwhelmingly likely reason a sync fails is that nothing is
        // connected — so offer the fix rather than just the complaint.
        if (!status?.connected) setShowForm(true);
      } else {
        setMessage(
          `Synced ${body.coursesSynced} courses, ${body.assignmentsSynced} assignments.`,
        );
        startTransition(() => router.refresh());
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/canvas/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: form.get("baseUrl"),
          token: form.get("token"),
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Couldn't connect.");
        return;
      }

      setStatus(body as CanvasStatus);
      setShowForm(false);
      setMessage(
        body.name ? `Connected as ${body.name}. Syncing…` : "Connected. Syncing…",
      );

      // Straight into a sync: connecting and then having to press a second
      // button to see anything is a needless extra step at the one moment the
      // student is waiting to find out whether it worked.
      await sync();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/canvas/connect", { method: "DELETE" });
      if (response.ok) {
        setStatus((await response.json()) as CanvasStatus);
        setMessage("Disconnected.");
      }
    } finally {
      setBusy(false);
    }
  }

  const working = busy || isPending;
  const needsConnecting = status !== null && !status.connected;

  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={needsConnecting ? () => setShowForm((open) => !open) : sync}
          disabled={working}
          className="control"
          data-active={needsConnecting ? "true" : undefined}
        >
          {working
            ? "Working…"
            : needsConnecting
              ? "Connect Canvas"
              : "Sync Canvas"}
        </button>

        {status?.connected ? (
          <>
            <span className="text-[0.75rem] text-ink-soft">
              {status.baseUrl?.replace(/^https:\/\//, "")}
              {status.tokenHint ? ` · ····${status.tokenHint}` : ""}
            </span>
            {!status.fromEnv ? (
              <button
                type="button"
                onClick={disconnect}
                disabled={working}
                className="text-[0.75rem] text-ink-soft underline underline-offset-2 hover:text-[color:var(--flare)]"
              >
                Disconnect
              </button>
            ) : null}
          </>
        ) : null}

        {message ? (
          <span className="text-[0.75rem]" style={{ color: "var(--jade)" }}>
            {message}
          </span>
        ) : null}
      </span>

      {error ? (
        <p className="text-[0.8125rem]" style={{ color: "var(--flare)" }}>
          {error}
        </p>
      ) : null}

      {showForm ? (
        <form onSubmit={connect} className="card flex flex-col gap-2.5 p-3">
          <label>
            <span className="rubric mb-1 block">Canvas address</span>
            <input
              name="baseUrl"
              required
              defaultValue={status?.baseUrl ?? ""}
              placeholder="canvas.yourschool.edu"
              className="field"
              autoComplete="off"
            />
          </label>

          <label>
            <span className="rubric mb-1 block">Access token</span>
            <input
              name="token"
              required
              type="password"
              placeholder="Paste your token"
              className="field"
              autoComplete="off"
            />
          </label>

          <p className="text-[0.75rem] leading-snug text-ink-soft">
            In Canvas: Account → Settings → New Access Token. Stored on your own
            server and never shown again after saving.
          </p>

          <div className="flex gap-2">
            <button type="submit" disabled={working} className="control" data-active="true">
              {working ? "Checking…" : "Connect"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="control"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
