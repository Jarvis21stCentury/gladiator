import "server-only";

/**
 * Canvas credentials. There is no login screen and no user table — the app runs
 * as a single identity, so these env vars *are* the account. See ARCHITECTURE.md.
 */
export interface CanvasConfig {
  baseUrl: string | null;
  token: string | null;
  /** Private "Calendar Feed" URL — the no-auth, due-dates-only fallback. */
  icalUrl: string | null;
}

function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getCanvasConfig(): CanvasConfig {
  return {
    baseUrl: read("CANVAS_BASE_URL"),
    token: read("CANVAS_TOKEN"),
    icalUrl: read("CANVAS_ICAL_URL"),
  };
}

export function hasApiCredentials(config: CanvasConfig): boolean {
  return Boolean(config.baseUrl && config.token);
}
