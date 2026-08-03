import "server-only";

import {
  GOOGLE_CALENDAR_SCOPE,
  getGoogleConfig,
  type GoogleConfig,
} from "./config";

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/**
 * One-time consent URL. `access_type=offline` + `prompt=consent` is what makes
 * Google hand back a refresh token — without both, a second authorisation
 * returns only an access token and the setup silently produces nothing usable.
 */
export function buildConsentUrl(config: GoogleConfig, state: string): string {
  if (!config.clientId || !config.redirectUri) {
    throw new GoogleAuthError(
      "GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI must be set before starting the OAuth flow.",
    );
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

async function postToken(
  config: GoogleConfig,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(`${config.oauthBase}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new GoogleAuthError(
      `Google token endpoint returned ${response.status}: ${text.slice(0, 400)}`,
      response.status,
    );
  }

  return JSON.parse(text) as TokenResponse;
}

/** Exchange the one-time authorisation code for a long-lived refresh token. */
export async function exchangeCodeForTokens(
  config: GoogleConfig,
  code: string,
): Promise<TokenResponse> {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new GoogleAuthError("OAuth client is not fully configured.");
  }

  return postToken(config, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Access tokens last an hour; a warm serverless instance handling several syncs
// shouldn't re-mint one every time. Keyed by refresh token so rotating the env
// var invalidates the cache instead of serving a token for the old account.
const tokenCache = new Map<string, CachedToken>();

export async function getAccessToken(
  config: GoogleConfig = getGoogleConfig(),
): Promise<string> {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new GoogleAuthError(
      "Google Calendar is not connected. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN — visit /api/google/auth to mint a refresh token.",
    );
  }

  const cached = tokenCache.get(config.refreshToken);
  // 60s of slack so a token can't expire mid-request.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const tokens = await postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  tokenCache.set(config.refreshToken, {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  return tokens.access_token;
}
