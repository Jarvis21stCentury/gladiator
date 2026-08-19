import "server-only";

import webpush from "web-push";

import { prisma } from "@/lib/prisma";

/**
 * Getting a message to the student when the app is closed.
 *
 * This is the piece that decides whether Gladiator is a tool that has your back
 * or a dashboard you have to remember to open. Everything else runs unattended
 * already — the evening cron syncs Canvas, reads the coursework pages, writes
 * the digest — and then it all sat in a database saying nothing.
 *
 * Web Push rather than email, for two reasons that matter here: it needs no
 * third-party account and costs nothing, and a notification lands where a
 * student actually is. The cost is that iOS only allows it for a site added to
 * the home screen, which the UI has to say plainly rather than silently failing.
 *
 * ## Why failures are counted rather than logged
 *
 * A push endpoint dies when the browser is uninstalled, the profile is cleared,
 * or the subscription simply expires — and the push service answers 404 or 410
 * forever after. Retrying those every night is a slow leak of time and log
 * noise. Those two statuses delete the row immediately; anything else (a
 * transient 5xx, a network blip) increments a counter and is dropped after
 * enough consecutive failures.
 */

/** Consecutive failures before a subscription is assumed dead. */
const MAX_FAILURES = 5;

export interface PushMessage {
  title: string;
  body: string;
  /** Where clicking it should land. Defaults to the front page. */
  url?: string;
  /** Collapses earlier notifications with the same tag instead of stacking. */
  tag?: string;
}

export interface PushResult {
  sent: number;
  removed: number;
  failed: number;
  /** Set when push is not configured at all, so callers can say so. */
  skipped?: string;
}

/** True when VAPID keys are present. Without them the app simply never pushes. */
export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() &&
      process.env.VAPID_PRIVATE_KEY?.trim(),
  );
}

function configure(): void {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:noreply@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );
}

/**
 * Send one message to every subscribed browser.
 *
 * Never throws. A notification failing is not a reason for the evening cron —
 * which has already done the sync and written the digest — to report failure.
 */
export async function sendPush(message: PushMessage): Promise<PushResult> {
  if (!pushConfigured()) {
    return { sent: 0, removed: 0, failed: 0, skipped: "VAPID keys not set." };
  }

  configure();

  const subscriptions = await prisma.pushSubscription.findMany();
  if (subscriptions.length === 0) {
    return { sent: 0, removed: 0, failed: 0, skipped: "No browsers subscribed." };
  }

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url ?? "/",
    tag: message.tag ?? "gladiator",
  });

  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );

      sent += 1;
      await prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { failures: 0, lastSentAt: new Date() },
      });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;

      // 404/410 mean the browser threw this subscription away. It will never
      // work again, so keeping it is pure noise.
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: subscription.id } });
        removed += 1;
        continue;
      }

      failed += 1;
      const next = subscription.failures + 1;

      if (next >= MAX_FAILURES) {
        await prisma.pushSubscription.delete({ where: { id: subscription.id } });
        removed += 1;
      } else {
        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { failures: next },
        });
      }
    }
  }

  return { sent, removed, failed };
}
