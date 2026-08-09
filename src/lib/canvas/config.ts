import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Canvas credentials.
 *
 * There is no login screen and no user table — the app runs as a single
 * identity, so these credentials *are* the account (ARCHITECTURE.md).
 *
 * They now come from two places, database first:
 *
 *   1. The `Setting` table, written by the connect form in the app.
 *   2. The matching environment variable.
 *
 * Env-only was fine for whoever deployed this and useless for the student using
 * it: connecting Canvas meant editing a file and restarting a server. Database
 * values win so the UI can override a stale env var, and the env fallback means
 * an existing deployment keeps working with nothing to migrate.
 *
 * **The token never leaves the server.** Nothing here is safe to hand to a
 * client component; use `getCanvasStatus()` for that, which reports whether a
 * credential exists without revealing it.
 */

export interface CanvasConfig {
  baseUrl: string | null;
  token: string | null;
  /** Private "Calendar Feed" URL — the no-auth, due-dates-only fallback. */
  icalUrl: string | null;
}

export const CANVAS_KEYS = {
  baseUrl: "CANVAS_BASE_URL",
  token: "CANVAS_TOKEN",
  icalUrl: "CANVAS_ICAL_URL",
} as const;

function fromEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export async function getCanvasConfig(): Promise<CanvasConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(CANVAS_KEYS) } },
  });

  const stored = new Map(rows.map((row) => [row.key, row.value.trim()]));
  const read = (key: string) => stored.get(key) || fromEnv(key);

  return {
    baseUrl: read(CANVAS_KEYS.baseUrl),
    token: read(CANVAS_KEYS.token),
    icalUrl: read(CANVAS_KEYS.icalUrl),
  };
}

export function hasApiCredentials(config: CanvasConfig): boolean {
  return Boolean(config.baseUrl && config.token);
}

/**
 * Normalise whatever a student pastes into the base URL field.
 *
 * They will paste `canvas.school.edu`, `https://canvas.school.edu/`, or the
 * whole URL of the page they were looking at when they found the token. All
 * three should work; asking someone to hand-format an origin is how a setup
 * screen fails.
 */
export function normaliseBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    // Canvas is always https, and the API lives at the origin — any path they
    // pasted along with it is a page they happened to be on.
    return `https://${url.host}`;
  } catch {
    return null;
  }
}

export interface CanvasStatus {
  /** Full API access: courses, grades, submissions. */
  connected: boolean;
  /** Due dates only, via the private calendar feed. */
  icalOnly: boolean;
  baseUrl: string | null;
  /** Last four characters, so a student can tell *which* token is stored. */
  tokenHint: string | null;
  /** True when the value came from an env var and the UI cannot overwrite it. */
  fromEnv: boolean;
}

/**
 * What the browser is allowed to know about the stored credentials.
 *
 * Deliberately not just `Omit<CanvasConfig, "token">`: the point is that this is
 * the *only* shape that crosses to the client, so it is written out explicitly
 * and the token is reduced to four characters that identify it without being
 * usable.
 */
export async function getCanvasStatus(): Promise<CanvasStatus> {
  const config = await getCanvasConfig();
  const stored = await prisma.setting.findUnique({
    where: { key: CANVAS_KEYS.token },
  });

  return {
    connected: hasApiCredentials(config),
    icalOnly: !hasApiCredentials(config) && Boolean(config.icalUrl),
    baseUrl: config.baseUrl,
    tokenHint: config.token ? config.token.slice(-4) : null,
    fromEnv: Boolean(config.token) && !stored,
  };
}

export async function saveCanvasCredentials(input: {
  baseUrl: string;
  token: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: CANVAS_KEYS.baseUrl },
      create: { key: CANVAS_KEYS.baseUrl, value: input.baseUrl },
      update: { value: input.baseUrl },
    }),
    prisma.setting.upsert({
      where: { key: CANVAS_KEYS.token },
      create: { key: CANVAS_KEYS.token, value: input.token },
      update: { value: input.token },
    }),
  ]);
}

export async function clearCanvasCredentials(): Promise<void> {
  await prisma.setting.deleteMany({
    where: { key: { in: [CANVAS_KEYS.baseUrl, CANVAS_KEYS.token] } },
  });
}
