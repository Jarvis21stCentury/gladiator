import "server-only";

import type { GoogleConfig } from "./config";
import { GoogleAuthError, getAccessToken } from "./oauth";

export interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  htmlLink?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

export interface GoogleEventInput {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  timeZone?: string;
  privateProperties?: Record<string, string>;
}

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

/**
 * Marker written into every event this app creates, so ownership is provable.
 *
 * These two strings keep the old `schoolOs` prefix deliberately, and must not be
 * renamed along with the product. They are stored *on the Google Calendar events
 * themselves*, and `isManagedByApp` matches on them: change the key and every
 * event this app has ever written stops being recognised as its own, gets marked
 * `userModified`, and is abandoned — while new duplicates are created alongside.
 * The name on the tin is display text; this is a storage key.
 */
export const MANAGED_BY_KEY = "schoolOsManaged";
export const MANAGED_BY_VALUE = "assignment-due";
export const ASSIGNMENT_ID_KEY = "schoolOsAssignmentId";

/**
 * Reminders on a due-date event, set once when it is created.
 *
 * This is the whole reason connecting a calendar is worth doing: the app has no
 * notification system of its own and does not want one — the calendar already
 * open on the student's phone does that job properly, on the lock screen,
 * without this app running.
 *
 * The evening before and two hours before, rather than Google's default ten
 * minutes. A ten-minute warning on a deadline is an obituary; the useful alert
 * for schoolwork is the one that arrives while there is still time to do
 * something about it.
 *
 * Only ever sent on **create**. Updates use PATCH without this field, so a
 * student who changes or silences the reminders on an event keeps their change
 * through every subsequent sync.
 */
const DUE_DATE_REMINDERS = {
  useDefault: false,
  overrides: [
    { method: "popup", minutes: 12 * 60 },
    { method: "popup", minutes: 2 * 60 },
  ],
};

function toEventBody(input: GoogleEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
    extendedProperties: input.privateProperties
      ? { private: input.privateProperties }
      : undefined,
  };
}

export class GoogleCalendarClient {
  private readonly config: GoogleConfig;

  constructor(config: GoogleConfig) {
    this.config = config;
  }

  get calendarId(): string {
    return this.config.calendarId;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const accessToken = await getAccessToken(this.config);

    const response = await fetch(`${this.config.apiBase}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => "");
      throw new GoogleAuthError(
        `Google rejected the credentials (HTTP ${response.status}). The refresh token may have been revoked, or the Cloud project's test-user access expired: ${body.slice(0, 300)}`,
        response.status,
      );
    }

    return response;
  }

  private eventPath(eventId?: string): string {
    const base = `/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  }

  /** Returns null when the event is gone — deleted by the user, or never existed. */
  async getEvent(eventId: string): Promise<GoogleEvent | null> {
    const response = await this.request(this.eventPath(eventId));

    if (response.status === 404 || response.status === 410) return null;

    if (!response.ok) {
      throw new GoogleCalendarError(
        `Failed to read event ${eventId}: HTTP ${response.status}`,
        response.status,
      );
    }

    const event = (await response.json()) as GoogleEvent;

    // Google keeps cancelled events readable for a while; treat them as deleted.
    return event.status === "cancelled" ? null : event;
  }

  /**
   * Every event this app manages, in as few requests as possible. Filtering on
   * the private marker means the sync never has to look at — let alone touch —
   * anything else on the calendar.
   */
  async listManagedEvents(): Promise<Map<string, GoogleEvent>> {
    const events = new Map<string, GoogleEvent>();
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        privateExtendedProperty: `${MANAGED_BY_KEY}=${MANAGED_BY_VALUE}`,
        maxResults: "2500",
        singleEvents: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await this.request(`${this.eventPath()}?${params}`);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new GoogleCalendarError(
          `Failed to list events: HTTP ${response.status} ${body.slice(0, 300)}`,
          response.status,
        );
      }

      const page = (await response.json()) as {
        items?: GoogleEvent[];
        nextPageToken?: string;
      };

      for (const event of page.items ?? []) {
        if (event.status !== "cancelled") events.set(event.id, event);
      }

      pageToken = page.nextPageToken;
      pages += 1;
    } while (pageToken && pages < 20);

    return events;
  }

  async createEvent(input: GoogleEventInput): Promise<GoogleEvent> {
    const response = await this.request(this.eventPath(), {
      method: "POST",
      // Reminders only on create — see DUE_DATE_REMINDERS.
      body: JSON.stringify({ ...toEventBody(input), reminders: DUE_DATE_REMINDERS }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GoogleCalendarError(
        `Failed to create event: HTTP ${response.status} ${body.slice(0, 300)}`,
        response.status,
      );
    }

    return (await response.json()) as GoogleEvent;
  }

  async updateEvent(
    eventId: string,
    input: GoogleEventInput,
  ): Promise<GoogleEvent | null> {
    // PATCH rather than PUT: leaves fields we don't manage (colour, reminders,
    // attendees the user added) untouched.
    const response = await this.request(this.eventPath(eventId), {
      method: "PATCH",
      body: JSON.stringify(toEventBody(input)),
    });

    if (response.status === 404 || response.status === 410) return null;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GoogleCalendarError(
        `Failed to update event ${eventId}: HTTP ${response.status} ${body.slice(0, 300)}`,
        response.status,
      );
    }

    return (await response.json()) as GoogleEvent;
  }

  /** Idempotent: an already-deleted event is a success, not an error. */
  async deleteEvent(eventId: string): Promise<void> {
    const response = await this.request(this.eventPath(eventId), {
      method: "DELETE",
    });

    if (response.ok || response.status === 404 || response.status === 410) {
      return;
    }

    throw new GoogleCalendarError(
      `Failed to delete event ${eventId}: HTTP ${response.status}`,
      response.status,
    );
  }
}

/** Did this app create the event, and is it still marked as ours? */
export function isManagedByApp(event: GoogleEvent): boolean {
  return event.extendedProperties?.private?.[MANAGED_BY_KEY] === MANAGED_BY_VALUE;
}

export function eventStart(event: GoogleEvent): Date | null {
  const raw = event.start?.dateTime ?? event.start?.date;
  return raw ? new Date(raw) : null;
}

export function eventEnd(event: GoogleEvent): Date | null {
  const raw = event.end?.dateTime ?? event.end?.date;
  return raw ? new Date(raw) : null;
}
