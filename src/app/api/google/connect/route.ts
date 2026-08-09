import { NextResponse } from "next/server";

import { clearGoogleCredentials, getGoogleStatus } from "@/lib/google/config";

export const dynamic = "force-dynamic";

/**
 * Google Calendar connection state.
 *
 * The connect action itself is a redirect to Google, so it lives at
 * `/api/google/auth` and is a link rather than a fetch. This route is the two
 * things the UI needs around it: what the current state is, and how to undo it.
 *
 * `GET` never returns the refresh token — only whether one exists, and whether
 * this deployment has an OAuth client registered at all. The second flag is the
 * one that matters for honesty: with no client configured the connect button
 * cannot work and no student can fix it, so the UI must say so rather than
 * offer a button that fails.
 */
export async function GET() {
  return NextResponse.json(await getGoogleStatus());
}

export async function DELETE() {
  await clearGoogleCredentials();
  return NextResponse.json(await getGoogleStatus());
}
