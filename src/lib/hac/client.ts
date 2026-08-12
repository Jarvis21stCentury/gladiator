import "server-only";

import { looksLikeLoginPage } from "./parse";

/**
 * Logging in to Home Access Center and fetching the grades page.
 *
 * HAC is an ASP.NET MVC application with no API. Signing in means doing what a
 * browser does: GET the login page, carry its anti-forgery token and cookies
 * into a POST, then follow the session. There is no supported alternative — see
 * ARCHITECTURE.md for the tradeoff this represents.
 *
 * ## What this deliberately does not do
 *
 * It does not retry a rejected password. A school portal locks an account after
 * a handful of failures, and a background job hammering a wrong password would
 * lock the student out of the system they actually need. A rejection is
 * reported once and the credential is left for a human to fix.
 */

/** HAC is slow; a hung sync should still give up. */
const TIMEOUT_MS = 25_000;

export class HacError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "network" | "shape",
  ) {
    super(message);
    this.name = "HacError";
  }
}

/**
 * The smallest possible cookie jar.
 *
 * Node's fetch has no cookie support, and HAC's session is entirely cookies.
 * Only name=value is kept: attributes like Path and Expires exist to tell a
 * browser when *not* to send a cookie, and this jar talks to exactly one host
 * for a few seconds.
 */
class CookieJar {
  private readonly jar = new Map<string, string>();

  absorb(response: Response): void {
    // getSetCookie keeps multiple Set-Cookie headers separate; reading the
    // header directly folds them into one comma-joined string, which splits
    // wrongly on cookies whose value contains a comma.
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (index < 1) continue;

      this.jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  get header(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export interface HacCredentials {
  /** Origin of the portal, e.g. `https://homeaccess.yourdistrict.org`. */
  baseUrl: string;
  username: string;
  password: string;
}

/** Pull an ASP.NET hidden input out of a form. */
function hiddenField(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`,
    "i",
  );
  const reversed = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`,
    "i",
  );

  // Attribute order is not guaranteed, and HAC's own pages are inconsistent
  // about it between versions.
  return html.match(pattern)?.[1] ?? html.match(reversed)?.[1] ?? null;
}

async function request(
  url: string,
  jar: CookieJar,
  init: RequestInit = {},
): Promise<{ response: Response; body: string }> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // A plain fetch UA is rejected outright by some district WAFs.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        ...(jar.header ? { Cookie: jar.header } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new HacError(
      `Couldn't reach ${new URL(url).host}. Check the address, and that you're on a network that can see it.`,
      "network",
    );
  }

  jar.absorb(response);

  // Follow redirects by hand so cookies set on each hop are kept — the session
  // cookie is frequently set on the redirect *away* from the login POST.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      return request(new URL(location, url).toString(), jar, { method: "GET" });
    }
  }

  return { response, body: await response.text() };
}

/**
 * Sign in and return the raw HTML of the grades page.
 *
 * Parsing is somebody else's job (`parse.ts`), so a district whose markup
 * differs can be fixed without touching any of this.
 */
export async function fetchHacGradesHtml(
  credentials: HacCredentials,
): Promise<string> {
  const base = credentials.baseUrl.replace(/\/+$/, "");
  const jar = new CookieJar();

  const loginUrl = `${base}/HomeAccess/Account/LogOn`;
  const { body: loginPage } = await request(loginUrl, jar);

  const token = hiddenField(loginPage, "__RequestVerificationToken");
  // Multi-district installs put the database selector on the login form; when
  // it is there it is required, and when it is absent sending it is harmless.
  const database = hiddenField(loginPage, "Database") ?? "10";

  const form = new URLSearchParams({
    "LogOnDetails.UserName": credentials.username,
    "LogOnDetails.Password": credentials.password,
    Database: database,
    SCKTY00328510CustomEnabled: "False",
    SCKTY00436568CustomEnabled: "False",
    tempUN: "",
    tempPW: "",
  });

  if (token) form.set("__RequestVerificationToken", token);

  const { body: afterLogin } = await request(loginUrl, jar, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: loginUrl,
    },
    body: form.toString(),
  });

  /*
   * A failed HAC login is HTTP 200 with the login form again. Without this
   * check, a wrong password is indistinguishable from a student with no
   * classes — and the app would cheerfully report "0 courses found".
   */
  if (looksLikeLoginPage(afterLogin)) {
    throw new HacError(
      "HAC rejected that username or password. Check them in a browser first — repeated failures can lock the account.",
      "auth",
    );
  }

  /*
   * Two grade pages, because districts expose different ones. Assignments
   * carries running averages; Report Card carries posted marks. Both are tried
   * and the results are merged upstream, so a portal offering either works.
   */
  const pages = [
    `${base}/HomeAccess/Content/Student/Assignments.aspx`,
    `${base}/HomeAccess/Content/Student/ReportCards.aspx`,
  ];

  const collected: string[] = [];

  for (const page of pages) {
    try {
      const { response, body } = await request(page, jar, { method: "GET" });
      if (response.ok && !looksLikeLoginPage(body)) collected.push(body);
    } catch {
      // One missing view is normal; only both failing is a problem.
    }
  }

  if (collected.length === 0) {
    throw new HacError(
      "Signed in, but neither grade page could be read. Your district may use a different HAC layout.",
      "shape",
    );
  }

  return collected.join("\n");
}
