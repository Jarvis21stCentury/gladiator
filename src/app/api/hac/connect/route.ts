import { NextResponse } from "next/server";

import { fetchHacGradesHtml, HacError } from "@/lib/hac/client";
import {
  clearHacCredentials,
  getHacStatus,
  saveHacCredentials,
} from "@/lib/hac/config";
import { parseHacGrades } from "@/lib/hac/parse";
import {
  canStoreSecrets,
  MissingCredentialSecretError,
} from "@/lib/crypto/secret";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Connect Home Access Center.
 *
 * `GET` reports whether credentials exist, the portal host and the username —
 * **never the password**, encrypted or otherwise.
 *
 * `POST` signs in *before* storing anything. Saving an unverified school
 * password is worse here than anywhere else in this app: the failure would
 * surface later as a background sync repeatedly presenting a wrong password to
 * a system that locks accounts. Verifying once, in the foreground, with the
 * student watching, is the only responsible order.
 */
export async function GET() {
  return NextResponse.json(await getHacStatus());
}

export async function POST(request: Request) {
  let body: { baseUrl?: unknown; username?: unknown; password?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  /*
   * Refuse before the password goes anywhere.
   *
   * The verify-then-store order is right, but it meant a deployment with no
   * encryption key would still send the student's district password across the
   * network to HAC and only then refuse to keep it. If it cannot be stored, it
   * should not be transmitted either.
   */
  if (!canStoreSecrets()) {
    return NextResponse.json(
      { error: new MissingCredentialSecretError().message },
      { status: 400 },
    );
  }

  const rawBase = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!rawBase || !username || !password) {
    return NextResponse.json(
      { error: "Address, username and password are all required." },
      { status: 400 },
    );
  }

  let baseUrl: string;

  try {
    const withScheme = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
    baseUrl = `https://${new URL(withScheme).host}`;
  } catch {
    return NextResponse.json(
      { error: "That doesn't look like a web address. Try homeaccess.yourdistrict.org." },
      { status: 400 },
    );
  }

  const credentials = { baseUrl, username, password };

  try {
    const found = parseHacGrades(await fetchHacGradesHtml(credentials));

    await saveHacCredentials(credentials);

    return NextResponse.json({
      ...(await getHacStatus()),
      coursesFound: found.length,
      courses: found.map((course) => course.name),
    });
  } catch (error) {
    if (error instanceof MissingCredentialSecretError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof HacError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.kind === "auth" ? 401 : 502 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  await clearHacCredentials();
  return NextResponse.json(await getHacStatus());
}
