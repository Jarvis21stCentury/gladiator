import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getGoogleConfig, hasOAuthClient } from "@/lib/google/config";
import { buildConsentUrl } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * One-time setup: visit this in a browser, consent as the personal Google
 * account, and the callback hands back a refresh token to paste into the
 * environment. Nothing here runs during normal operation.
 */
export async function GET() {
  const config = await getGoogleConfig();

  if (!hasOAuthClient(config)) {
    return NextResponse.json(
      {
        error:
          "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI first. See .env.example.",
      },
      { status: 400 },
    );
  }

  // CSRF guard on the redirect. Single-user app, so a signed cookie is overkill;
  // an httpOnly cookie compared on return is enough.
  const state = randomBytes(16).toString("hex");

  const response = NextResponse.redirect(buildConsentUrl(config, state));
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return response;
}
