import { NextResponse } from "next/server";

import {
  clearCanvasCredentials,
  getCanvasStatus,
  normaliseBaseUrl,
  saveCanvasCredentials,
} from "@/lib/canvas/config";

export const dynamic = "force-dynamic";

/**
 * Connect a Canvas account from inside the app.
 *
 * Before this, connecting Canvas meant editing an env file and restarting the
 * server. That is a fine developer workflow and a non-starter for a student,
 * which made "ready for school" untrue no matter how good the rest was.
 *
 * ## What crosses the wire
 *
 * `GET` returns `CanvasStatus` — whether a credential exists, which host, and
 * the token's last four characters. **The token itself is never returned**, by
 * any method, including to the page that just saved it.
 *
 * ## The credential is checked before it is stored
 *
 * A token is verified with a real call to `/api/v1/users/self` first. Saving an
 * unvalidated secret means the student finds out it was wrong later, from a
 * failed sync, with no idea whether the problem was the token, the URL or the
 * school disabling personal tokens — three very different fixes. Failing here
 * lets the error name the actual cause.
 */

/** A token check should not hang the form. */
const VERIFY_TIMEOUT_MS = 12_000;

export async function GET() {
  return NextResponse.json(await getCanvasStatus());
}

export async function POST(request: Request) {
  let body: { baseUrl?: unknown; token?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const rawBase = typeof body.baseUrl === "string" ? body.baseUrl : "";
  const token = (typeof body.token === "string" ? body.token : "").trim();

  const baseUrl = normaliseBaseUrl(rawBase);

  if (!baseUrl) {
    return NextResponse.json(
      { error: "That doesn't look like a Canvas address. Try canvas.yourschool.edu." },
      { status: 400 },
    );
  }

  if (!token) {
    return NextResponse.json({ error: "Paste your access token." }, { status: 400 });
  }

  /* ---- Verify against the real Canvas before storing anything ---- */
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/api/v1/users/self`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json(
      {
        error: `Couldn't reach ${baseUrl}. Check the address — it's the one you see when you're logged into Canvas.`,
      },
      { status: 502 },
    );
  }

  if (response.status === 401 || response.status === 403) {
    return NextResponse.json(
      {
        error:
          "Canvas rejected that token. It may be expired, or your school may have personal access tokens turned off.",
      },
      { status: 401 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: `Canvas responded ${response.status}. Check the address is right.` },
      { status: 502 },
    );
  }

  // Confirms it is really a Canvas API and gives the student something
  // recognisable back, so they can tell they connected the right account.
  const profile = (await response.json().catch(() => null)) as {
    name?: string;
  } | null;

  await saveCanvasCredentials({ baseUrl, token });

  return NextResponse.json({
    ...(await getCanvasStatus()),
    name: typeof profile?.name === "string" ? profile.name : null,
  });
}

export async function DELETE() {
  await clearCanvasCredentials();
  return NextResponse.json(await getCanvasStatus());
}
