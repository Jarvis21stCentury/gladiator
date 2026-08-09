import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Google credentials for a *personal* account — not the school Workspace account.
 * The Cloud project stays in Testing mode with the developer as the sole test
 * user, so no verification is needed at this scale (ARCHITECTURE.md).
 *
 * ## Two kinds of credential, and only one of them is the student's
 *
 * `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` identify
 * *the application*. They belong to whoever deployed it, they are the same for
 * everyone using that deployment, and no student can produce them — creating
 * them means owning a Google Cloud project. They stay in the environment.
 *
 * `GOOGLE_REFRESH_TOKEN` is the *account*: it is what consenting produces, and
 * it is per-person. That is the one the student obtains by pressing a button, so
 * it is stored in the `Setting` table like the Canvas token, database first with
 * the env var as a fallback.
 *
 * Before this, the OAuth callback printed the refresh token on a page and asked
 * you to paste it into `.env` and restart the server. That is a developer
 * handoff, not a feature.
 *
 * **The refresh token never leaves the server.** Use `getGoogleStatus()` for
 * anything the browser sees.
 */

export const GOOGLE_KEYS = {
  refreshToken: "GOOGLE_REFRESH_TOKEN",
  calendarId: "GOOGLE_CALENDAR_ID",
} as const;

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

export async function getGoogleConfig(): Promise<GoogleConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(GOOGLE_KEYS) } },
  });

  const stored = new Map(rows.map((row) => [row.key, row.value.trim()]));

  return {
    // App identity: environment only. A student cannot mint these.
    clientId: read("GOOGLE_CLIENT_ID"),
    clientSecret: read("GOOGLE_CLIENT_SECRET"),
    redirectUri: read("GOOGLE_REDIRECT_URI"),
    // The account: whatever consent produced, else the env fallback.
    refreshToken:
      stored.get(GOOGLE_KEYS.refreshToken) || read(GOOGLE_KEYS.refreshToken),
    calendarId:
      stored.get(GOOGLE_KEYS.calendarId) || read(GOOGLE_KEYS.calendarId) ||
      "primary",
    oauthBase: read("GOOGLE_OAUTH_BASE") ?? "https://oauth2.googleapis.com",
    apiBase: read("GOOGLE_API_BASE") ?? "https://www.googleapis.com",
  };
}

export interface GoogleStatus {
  /** Consent has been given and a refresh token is stored. */
  connected: boolean;
  /**
   * Whether this deployment can offer the connect button at all. False means
   * the *operator* has not registered a Google OAuth client — which no student
   * can fix, so the UI has to say so rather than offer a button that 400s.
   */
  available: boolean;
  calendarId: string;
  /** Token came from an env var, so the UI must not offer to disconnect it. */
  fromEnv: boolean;
}

export async function getGoogleStatus(): Promise<GoogleStatus> {
  const config = await getGoogleConfig();
  const stored = await prisma.setting.findUnique({
    where: { key: GOOGLE_KEYS.refreshToken },
  });

  return {
    connected: isCalendarConfigured(config),
    available: hasOAuthClient(config),
    calendarId: config.calendarId,
    fromEnv: Boolean(config.refreshToken) && !stored,
  };
}

export async function saveGoogleRefreshToken(token: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: GOOGLE_KEYS.refreshToken },
    create: { key: GOOGLE_KEYS.refreshToken, value: token },
    update: { value: token },
  });
}

export async function clearGoogleCredentials(): Promise<void> {
  await prisma.setting.deleteMany({
    where: { key: { in: [GOOGLE_KEYS.refreshToken] } },
  });
}

export function hasOAuthClient(config: GoogleConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

export function isCalendarConfigured(config: GoogleConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}
