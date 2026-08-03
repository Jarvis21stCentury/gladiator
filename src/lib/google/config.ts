import "server-only";

/**
 * Google credentials for a *personal* account — not the school Workspace account.
 * The Cloud project stays in Testing mode with the developer as the sole test
 * user, so no verification is needed at this scale (ARCHITECTURE.md).
 *
 * As with Canvas, there is no user table: the refresh token in the environment
 * is the account.
 */

/** Narrowest scope that still allows creating and updating events. */
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

export interface GoogleConfig {
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  redirectUri: string | null;
  calendarId: string;
  /** Base URLs are overridable so the sync can be pointed at a local fake. */
  oauthBase: string;
  apiBase: string;
}

function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getGoogleConfig(): GoogleConfig {
  return {
    clientId: read("GOOGLE_CLIENT_ID"),
    clientSecret: read("GOOGLE_CLIENT_SECRET"),
    refreshToken: read("GOOGLE_REFRESH_TOKEN"),
    redirectUri: read("GOOGLE_REDIRECT_URI"),
    calendarId: read("GOOGLE_CALENDAR_ID") ?? "primary",
    oauthBase: read("GOOGLE_OAUTH_BASE") ?? "https://oauth2.googleapis.com",
    apiBase: read("GOOGLE_API_BASE") ?? "https://www.googleapis.com",
  };
}

export function hasOAuthClient(config: GoogleConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

export function isCalendarConfigured(config: GoogleConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}
