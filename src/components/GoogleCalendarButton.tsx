"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

interface GoogleStatus {
  connected: boolean;
  available: boolean;
  calendarId: string;
  fromEnv: boolean;
}

/**
 * Connect Google Calendar.
 *
 * Connecting is a redirect to Google's consent screen, so the button is a link
 * to `/api/google/auth` rather than a fetch — an OAuth flow cannot happen inside
 * an XHR. Google sends the browser back to `/?google=connected`, which this
 * reads to show the confirmation and then strips from the URL, so a refresh
 * doesn't re-announce it.
 *
 * Once connected, every assignment due date is pushed to the calendar as a real
 * event — which is what makes reminders arrive on a phone. This app has no
 * notification system of its own and does not want one: the calendar the student
 * already has open all day does that job properly.
 *
 * The disconnect button is hidden when the token came from an environment
 * variable, because deleting the database row would not remove it and the
 * button would appear to do nothing.
 */
export function GoogleCalendarButton() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Read once, at mount, from the `?google=connected` Google redirected back to.
   *
   * A state initializer rather than a `setState` inside an effect: the effect
   * form causes a cascading render, and the flag has to survive the effect
   * below stripping the parameter out of the URL — derived straight from the
   * search params it would flip back to false the moment the URL was cleaned
   * and the confirmation would vanish instantly.
   */
  const [justConnected] = useState(() => params.get("google") === "connected");

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/google/connect")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data as GoogleStatus);
      })
      .catch(() => {
        /* Status is an enhancement — the rest of the page is unaffected. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* Strip the marker so a refresh doesn't re-announce a week-old connection. */
  useEffect(() => {
    if (!justConnected) return;
    startTransition(() => router.replace("/"));
  }, [justConnected, router]);

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/google/connect", { method: "DELETE" });
      if (response.ok) {
        setStatus((await response.json()) as GoogleStatus);
      }
    } finally {
      setBusy(false);
    }
  }

  // Nothing is rendered until the status is known: flashing "Connect Google
  // Calendar" at someone who connected it last week is worse than a beat of
  // nothing.
  if (!status) return null;

  /*
   * No OAuth client on this deployment. The student cannot fix this — it means
   * registering a Google Cloud project — so the honest thing is to say what is
   * missing and who can do it, not to show a button that returns a 400.
   */
  if (!status.available) {
    return (
      <span className="text-[0.75rem] text-ink-soft">
        Google Calendar unavailable — this deployment has no Google OAuth client
        configured.
      </span>
    );
  }

  if (status.connected) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[0.75rem]" style={{ color: "var(--jade)" }}>
          {justConnected ? "Google Calendar connected." : "Google Calendar on"}
        </span>
        <span className="text-[0.75rem] text-ink-soft">
          due dates sync to {status.calendarId}
        </span>
        {!status.fromEnv ? (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="text-[0.75rem] text-ink-soft underline underline-offset-2 hover:text-[color:var(--flare)]"
          >
            Disconnect
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {/* A link, not a button with onClick: this leaves the app for Google's
          consent screen, and that is a navigation. */}
      <a href="/api/google/auth" className="control no-underline">
        Connect Google Calendar
      </a>
      <span className="text-[0.75rem] text-ink-soft">
        puts due dates in your calendar, with reminders
      </span>
    </span>
  );
}
