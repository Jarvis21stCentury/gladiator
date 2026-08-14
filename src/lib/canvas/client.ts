import "server-only";

import type {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasCourse,
  CanvasModule,
  CanvasPage,
} from "./types";

/** Token is missing, revoked, or the account has personal tokens disabled. */
export class CanvasAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CanvasAuthError";
  }
}

export class CanvasApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}

/** Pull the rel="next" URL out of a Canvas `Link` header. */
function parseNextLink(header: string | null): string | null {
  if (!header) return null;

  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") return match[1];
  }

  return null;
}

export interface CanvasClientOptions {
  baseUrl: string;
  token: string;
  /** Guards against a pagination bug walking the API forever. */
  maxPages?: number;
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly maxPages: number;

  constructor({ baseUrl, token, maxPages = 50 }: CanvasClientOptions) {
    if (!token) {
      throw new CanvasAuthError("CANVAS_TOKEN is not set.");
    }

    // Accept "school.instructure.com", with or without scheme or trailing slash.
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    this.baseUrl = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    this.token = token;
    this.maxPages = maxPages;
  }

  private async request(url: string): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      // Sync results are written to Postgres; never serve these from a cache.
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      throw new CanvasAuthError(
        `Canvas rejected the access token (HTTP ${response.status}). The token may be revoked, or personal access tokens may be disabled for this account.`,
        response.status,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new CanvasApiError(
        `Canvas API ${response.status} for ${url}${body ? `: ${body.slice(0, 300)}` : ""}`,
        response.status,
      );
    }

    return response;
  }

  /** GET a paginated collection, following `Link: rel="next"` to the end. */
  private async getAll<T>(
    path: string,
    params: Record<string, string | string[]> = {},
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    url.searchParams.set("per_page", "100");

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, value);
      }
    }

    const results: T[] = [];
    let next: string | null = url.toString();
    let pages = 0;

    while (next && pages < this.maxPages) {
      const response: Response = await this.request(next);
      const page: unknown = await response.json();

      if (!Array.isArray(page)) {
        throw new CanvasApiError(
          `Expected an array from ${next}, got ${typeof page}.`,
          response.status,
        );
      }

      results.push(...(page as T[]));
      next = parseNextLink(response.headers.get("link"));
      pages += 1;
    }

    return results;
  }

  /**
   * Active courses for the current user, with the current grade attached.
   * `total_scores` is what puts `computed_current_score` on the enrollment.
   */
  async getCourses(): Promise<CanvasCourse[]> {
    const courses = await this.getAll<CanvasCourse>("/courses", {
      enrollment_state: "active",
      "include[]": ["total_scores", "term"],
    });

    // Concluded/restricted courses come back as stubs with no usable name.
    return courses.filter(
      (course) => !course.access_restricted_by_date && Boolean(course.name),
    );
  }

  async getAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.getAll<CanvasAssignment>(`/courses/${courseId}/assignments`, {
      "include[]": ["submission"],
      order_by: "due_at",
    });
  }

  /**
   * Announcements are fetched across all courses in one call — the endpoint takes
   * repeated `context_codes[]`, so this is one request instead of N.
   */
  async getAnnouncements(courseIds: number[]): Promise<CanvasAnnouncement[]> {
    if (courseIds.length === 0) return [];

    // Canvas defaults to the last 14 days; ask for a wider window explicitly.
    const start = new Date();
    start.setDate(start.getDate() - 90);

    return this.getAll<CanvasAnnouncement>("/announcements", {
      "context_codes[]": courseIds.map((id) => `course_${id}`),
      start_date: start.toISOString(),
      end_date: new Date().toISOString(),
    });
  }

  /**
   * Course modules with their items — the "what was covered in class" surface
   * the nightly digest reads. Item bodies are not included; fetch Page bodies
   * separately with `getPage`.
   */
  async getModules(courseId: number): Promise<CanvasModule[]> {
    const modules = await this.getAll<CanvasModule>(
      `/courses/${courseId}/modules`,
      { "include[]": ["items"] },
    );

    // Unpublished modules aren't visible to the student yet.
    return modules.filter((module) => module.published !== false);
  }

  /**
   * Every wiki page in a course, without bodies.
   *
   * The list endpoint omits `body`, which is what makes this cheap enough to
   * call for every class: one request finds the page you want by title, and
   * only that one is fetched in full. Needed because a teacher's daily
   * "Coursework" page is very often not in a module at all — it is linked from
   * the course nav — so scanning modules never sees it.
   */
  async getPages(courseId: number): Promise<CanvasPage[]> {
    try {
      const pages = await this.getAll<CanvasPage>(`/courses/${courseId}/pages`, {
        sort: "updated_at",
        order: "desc",
      });

      return pages.filter((page) => page.published !== false);
    } catch (error) {
      // Pages can be disabled per course. That is a normal configuration, not a
      // failure, and it must not take down the rest of the ingest.
      if (error instanceof CanvasAuthError) throw error;
      return [];
    }
  }

  /**
   * A wiki page's body. Returns null when the page is missing or restricted —
   * one unreadable page shouldn't fail a whole course's digest.
   */
  async getPage(courseId: number, pageUrl: string): Promise<CanvasPage | null> {
    try {
      const response = await this.request(
        `${this.baseUrl}/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`,
      );

      return (await response.json()) as CanvasPage;
    } catch (error) {
      // A revoked token still has to stop the run; a missing or locked page
      // does not (`request` throws on any non-2xx).
      if (error instanceof CanvasAuthError) throw error;
      return null;
    }
  }

  /**
   * Every page in a course, from both places one can live.
   *
   * `getPages` reads the Pages *index*, and this district's Canvas template
   * hides it: five of seven classes here return an empty list while their pages
   * sit inside modules as Page items — "Q1 | Week 1", "Quarter 1 I Week 1",
   * "Unit 1 Overview". Any feature that read only the index concluded those
   * classes had no content, which was wrong about the majority of them.
   *
   * Module items win their label (module name plus item title) because it says
   * where the page sits in the course; the index only has a bare title.
   */
  async getAllPageRefs(
    courseId: number,
  ): Promise<{ url: string; title: string }[]> {
    const refs = new Map<string, string>();

    for (const page of await this.getPages(courseId)) {
      if (!refs.has(page.url)) refs.set(page.url, page.title);
    }

    for (const canvasModule of await this.getModules(courseId)) {
      for (const item of canvasModule.items ?? []) {
        if (item.type !== "Page" || !item.page_url) continue;
        if (item.published === false) continue;

        if (!refs.has(item.page_url)) {
          refs.set(item.page_url, `${canvasModule.name} › ${item.title}`);
        }
      }
    }

    return [...refs].map(([url, title]) => ({ url, title }));
  }

  /**
   * The HTML of a course's Syllabus tab.
   *
   * Not part of the course list payload — `syllabus_body` has to be asked for
   * by name on the single-course endpoint. It is where teachers most reliably
   * link the assessment plan, so it is worth the extra request per class.
   */
  async getSyllabusBody(courseId: number): Promise<string | null> {
    try {
      const response = await this.request(
        `${this.baseUrl}/api/v1/courses/${courseId}?include[]=syllabus_body`,
      );

      const course = (await response.json()) as { syllabus_body?: string | null };
      return course.syllabus_body ?? null;
    } catch (error) {
      // A course with the syllabus tab disabled is a normal configuration.
      if (error instanceof CanvasAuthError) throw error;
      return null;
    }
  }

  /** Cheap round-trip to check the token before running a full sync. */
  async verifyToken(): Promise<void> {
    await this.request(`${this.baseUrl}/api/v1/users/self`);
  }
}
