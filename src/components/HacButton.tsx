"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

interface HacStatus {
  connected: boolean;
  available: boolean;
  baseUrl: string | null;
  username: string | null;
}

/**
 * Connect Home Access Center, and pull grades from it.
 *
 * The one place in this app that asks for a real password rather than a
 * revocable token, so the form says so plainly. A student should be able to
 * decide with the tradeoff in front of them, not discover it later.
 *
 * The password is sent once, verified against the portal, then stored
 * encrypted. It is never returned by any endpoint and this component never
 * holds it after the request that saved it.
 */
export function HacButton() {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [status, setStatus] = useState<HacStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/hac/connect")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data as HacStatus);
      })
      .catch(() => {
        /* Status is an enhancement. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/hac/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: form.get("baseUrl"),
          username: form.get("username"),
          password: form.get("password"),
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Couldn't connect.");
        return;
      }

      setStatus(body as HacStatus);
      setShowForm(false);
      setMessage(
        `Connected. Found ${body.coursesFound} class${body.coursesFound === 1 ? "" : "es"}.`,
      );
      await sync();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/hac/sync", { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        setError(body.message ?? "Grade sync failed.");
        return;
      }

      setMessage(body.message);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/hac/connect", { method: "DELETE" });
      if (response.ok) {
        setStatus((await response.json()) as HacStatus);
        setMessage("Disconnected. The stored password has been deleted.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  /* No encryption key, so storing a password is refused rather than done badly. */
  if (!status.available) {
    return (
      <span className="text-[0.75rem] text-ink-soft">
        HAC unavailable — set <code className="docket">CREDENTIAL_SECRET</code> in
        .env first. Without it a password would have to be stored in plain text.
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={status.connected ? sync : () => setShowForm((open) => !open)}
          disabled={busy}
          className="control"
          data-active={status.connected ? undefined : "true"}
        >
          {busy
            ? "Working…"
            : status.connected
              ? "Get grades from HAC"
              : "Connect HAC"}
        </button>

        {status.connected ? (
          <>
            <span className="text-[0.75rem] text-ink-soft">
              {status.baseUrl?.replace(/^https:\/\//, "")} · {status.username}
            </span>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="text-[0.75rem] text-ink-soft underline underline-offset-2 hover:text-[color:var(--flare)]"
            >
              Disconnect
            </button>
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
            <span className="rubric mb-1 block">HAC address</span>
            <input
              name="baseUrl"
              required
              defaultValue={status.baseUrl ?? ""}
              placeholder="homeaccess.yourdistrict.org"
              className="field"
              autoComplete="off"
            />
          </label>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <label className="flex-1">
              <span className="rubric mb-1 block">Username</span>
              <input
                name="username"
                required
                defaultValue={status.username ?? ""}
                className="field"
                autoComplete="off"
              />
            </label>
            <label className="flex-1">
              <span className="rubric mb-1 block">Password</span>
              <input
                name="password"
                required
                type="password"
                className="field"
                autoComplete="off"
              />
            </label>
          </div>

          {/* Said plainly, once, at the moment of the decision. */}
          <p className="text-[0.75rem] leading-snug text-ink-soft">
            This is your real district password, not a revocable token. It&apos;s
            checked against HAC before being saved, then stored encrypted on your
            own server — but the server has to be able to decrypt it to sign in.
            Disconnecting deletes it.
          </p>

          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="control" data-active="true">
              {busy ? "Checking…" : "Connect"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="control">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
