import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { pushConfigured, sendPush } from "@/lib/push/send";

export const dynamic = "force-dynamic";

/**
 * Subscribe this browser, unsubscribe it, or send it a test.
 *
 * One route for all three because they are the same object from three angles,
 * and a separate file each would be three places to keep the shape in sync.
 */

/** Register a browser. Idempotent — re-subscribing refreshes the keys. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    label?: string;
  } | null;

  if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth) {
    return NextResponse.json({ error: "Incomplete subscription." }, { status: 400 });
  }

  /*
   * Upsert on endpoint, not create. A browser re-subscribes on its own —
   * after a key rotation, a permission reset, or simply revisiting — and each
   * of those would otherwise stack another row that pushes a duplicate
   * notification to the same device.
   */
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      label: body.label ?? null,
    },
    update: {
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      label: body.label ?? null,
      failures: 0,
    },
  });

  return NextResponse.json({
    ok: true,
    subscriptions: await prisma.pushSubscription.count(),
  });
}

export async function DELETE(request: Request) {
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required." }, { status: 400 });
  }

  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}

/** Send a test notification to every subscribed browser. */
export async function PUT() {
  if (!pushConfigured()) {
    return NextResponse.json(
      { error: "Push is not configured — VAPID keys are missing." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    await sendPush({
      title: "Gladiator",
      body: "Notifications are working. You'll get one each evening.",
      tag: "test",
    }),
  );
}

export async function GET() {
  return NextResponse.json({
    configured: pushConfigured(),
    subscriptions: await prisma.pushSubscription.count(),
  });
}
