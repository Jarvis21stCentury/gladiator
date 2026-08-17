import { NextResponse, type NextRequest } from "next/server";

/**
 * A single shared password in front of everything.
 *
 * This app has no accounts — one deployment, one student, by design. On a paid
 * Vercel plan that gap is covered by Deployment Protection, but **Vercel
 * Authentication is not available for production deployments on the free
 * plan**: the API refuses it with `invalid_sso_protection`. Only preview URLs
 * are protected, and crons do not run against previews. So a free production
 * deployment is public to anyone who has or guesses the URL — and this one
 * holds grades and a district HAC login.
 *
 * Hence this. It is deliberately the smallest thing that closes the hole:
 *
 *   - One password from `APP_PASSWORD`, compared in constant time.
 *   - A signed, httpOnly cookie so it is asked for once per browser.
 *   - No user table, no sessions in the database, nothing to keep in sync.
 *
 * It is **not** multi-user. Everyone who knows the password shares one dataset,
 * exactly as before — this stops strangers, not friends. Real accounts are
 * MULTI-USER.md.
 *
 * With `APP_PASSWORD` unset the gate is off, which keeps local development
 * unchanged and means a misconfigured deploy fails open rather than locking the
 * owner out. That is the right trade for a personal tool: the URL is unguessable
 * enough that a brief window is survivable, whereas being locked out of your own
 * homework at 11pm is not.
 */

const COOKIE = "gladiator_auth";

/** Constant-time compare, so a wrong password cannot be found a byte at a time. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The cookie value: a hash of the password, so the password itself is never stored. */
async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`gladiator:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.next();

  const expected = await tokenFor(password);

  if (request.cookies.get(COOKIE)?.value === expected) {
    return NextResponse.next();
  }

  // Submitting the form posts here; anything else gets the form.
  if (request.method === "POST" && request.nextUrl.pathname === "/unlock") {
    const form = await request.formData();
    const given = String(form.get("password") ?? "");

    if (sameSecret(given, password)) {
      const response = NextResponse.redirect(new URL("/", request.url));
      response.cookies.set(COOKIE, expected, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
      return response;
    }
  }

  return new NextResponse(unlockPage(), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function unlockPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gladiator</title><style>
:root{color-scheme:light}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#FCFCFA;
color:#16233A;font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
form{width:min(22rem,90vw)}
h1{font-size:1.75rem;margin:0 0 .25rem;letter-spacing:-.01em}
p{margin:0 0 1.5rem;color:#5A6B85;font-size:.9375rem}
input{width:100%;box-sizing:border-box;padding:.6rem .75rem;font-size:1rem;
border:1px solid #C9D2E0;border-radius:.375rem;background:#fff;color:inherit}
input:focus{outline:2px solid #2B57C4;outline-offset:1px;border-color:#2B57C4}
button{margin-top:.75rem;width:100%;padding:.6rem;font-size:.8125rem;font-weight:500;
letter-spacing:.09em;text-transform:uppercase;color:#fff;background:#2B57C4;
border:0;border-radius:.375rem;cursor:pointer}
</style></head><body>
<form method="POST" action="/unlock">
<h1>Gladiator</h1>
<p>Enter the password to continue.</p>
<label for="p" style="position:absolute;left:-9999px">Password</label>
<input id="p" name="password" type="password" autofocus autocomplete="current-password">
<button type="submit">Unlock</button>
</form></body></html>`;
}

export const config = {
  // Everything except Next's own assets and the favicon — API routes included,
  // because /api/digest/generate spends money and must not be open either.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
