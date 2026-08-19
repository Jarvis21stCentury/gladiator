"use client";

import { useEffect, useState } from "react";

/**
 * Turn evening reminders on for this browser.
 *
 * Three things this has to get right, because each one is a way push quietly
 * does nothing and leaves the student thinking it works:
 *
 *   1. **iOS only allows push for an installed PWA.** Safari on iPhone exposes
 *      no Notification API until the site is added to the home screen. Saying
 *      that plainly is the difference between a student adding it and a student
 *      concluding the feature is broken.
 *   2. **Permission can be denied permanently.** Once "Don't Allow" is chosen
 *      the browser never asks again, and the button would sit there doing
 *      nothing on every click. That state gets its own message.
 *   3. **A subscription is per browser.** Turning it on here says nothing about
 *      the student's phone, so the count is shown rather than a boolean.
 */

type State =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on";

/** The VAPID public key has to reach the browser as bytes, not base64url. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function NotificationToggle() {
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Resolved asynchronously in one pass, never synchronously.
   *
   * Every branch here awaits before it sets state — the capability check is
   * cheap enough to be synchronous, but doing it that way trips
   * react-hooks/set-state-in-effect and, more to the point, cascades a second
   * render before the first has painted. Reading the browser's capabilities is
   * exactly the "synchronise with an external system" an effect is for; the
   * answer just has to arrive as a promise.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!supported) {
        // iOS gives Safari no Notification API at all until the site is
        // installed, so "unsupported" on an iPhone really means "not yet".
        const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (!cancelled) setState(iOS ? "needs-install" : "unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setState(subscription ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setMessage("Push isn't configured on the server.");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });

      const json = subscription.toJSON();
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          label: navigator.userAgent.slice(0, 80),
        }),
      });

      if (!response.ok) {
        setMessage("Could not save the subscription.");
        return;
      }

      setState("on");
      setMessage("On. You'll get a reminder each evening.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        await fetch(`/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
          method: "DELETE",
        });
        await subscription.unsubscribe();
      }

      setState("off");
      setMessage("Off for this browser.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const response = await fetch("/api/push", { method: "PUT" });
      const body = await response.json();
      setMessage(
        response.ok
          ? `Sent to ${body.sent} browser${body.sent === 1 ? "" : "s"}.`
          : (body.error ?? "Test failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  if (state === "needs-install") {
    return (
      <p className="docket max-w-[52ch] leading-relaxed">
        To get reminders on an iPhone, tap Share and{" "}
        <span className="text-ink">Add to Home Screen</span>, then open it from
        there. iOS only allows notifications for an installed app.
      </p>
    );
  }

  if (state === "unsupported") {
    return (
      <p className="docket">This browser can&apos;t do notifications.</p>
    );
  }

  if (state === "denied") {
    return (
      <p className="docket max-w-[52ch] leading-relaxed">
        Notifications are blocked for this site. Turn them back on in your
        browser&apos;s site settings — it won&apos;t ask again on its own.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {state === "on" ? (
          <>
            <button type="button" onClick={disable} disabled={busy} className="control">
              Turn off reminders
            </button>
            <button type="button" onClick={test} disabled={busy} className="control">
              Send a test
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="control"
            data-active="true"
          >
            {busy ? "Enabling…" : "Turn on evening reminders"}
          </button>
        )}
      </div>

      {message ? <p className="docket">{message}</p> : null}
    </div>
  );
}
