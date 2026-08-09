import { NextResponse } from "next/server";

import { getGoogleConfig, saveGoogleRefreshToken } from "@/lib/google/config";
import { exchangeCodeForTokens } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status: number) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:44rem;margin:3rem auto;line-height:1.5">${body}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (error) {
    return page("Authorisation failed", `<h1>Authorisation failed</h1><p>Google returned: <code>${error}</code></p>`, 400);
  }

  if (!code) {
    return page("Missing code", "<h1>Missing code</h1><p>No authorisation code in the callback.</p>", 400);
  }

  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "google_oauth_state")?.[1];

  if (!state || !cookieState || state !== cookieState) {
    return page(
      "State mismatch",
      "<h1>State mismatch</h1><p>Start again from <code>/api/google/auth</code> in the same browser.</p>",
      400,
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(await getGoogleConfig(), code);

    if (!tokens.refresh_token) {
      return page(
        "No refresh token",
        `<h1>No refresh token returned</h1>
         <p>Google only issues one on first consent. Remove Gladiator from
         <a href="https://myaccount.google.com/permissions">your account permissions</a>
         and run the flow again.</p>`,
        400,
      );
    }

    /*
     * Stored, not displayed.
     *
     * This page used to print the refresh token in a <pre> and ask you to paste
     * it into `.env` and restart the server — a developer handoff standing in
     * the middle of a student's setup. It now goes straight into the `Setting`
     * table and the browser is sent back to the app connected.
     *
     * The token is never rendered. A secret echoed into HTML lands in the
     * browser's history, its cache, and any screenshot of the moment it worked.
     */
    await saveGoogleRefreshToken(tokens.refresh_token);

    const response = NextResponse.redirect(new URL("/?google=connected", request.url));
    response.cookies.delete("google_oauth_state");
    return response;
  } catch (cause) {
    return page(
      "Token exchange failed",
      `<h1>Token exchange failed</h1><pre>${cause instanceof Error ? cause.message : String(cause)}</pre>`,
      502,
    );
  }
}
