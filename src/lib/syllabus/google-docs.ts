/**
 * Reading the shared Google Docs teachers link out of Canvas.
 *
 * Nearly every class here keeps its real schedule in a Google Doc or Sheet —
 * "Assessment Plan", "Unit 3 Calendar", the syllabus itself — linked from
 * Canvas and shared as *anyone with the link can view*. Those documents are
 * where test dates actually live. Canvas rarely has them: a test that is not a
 * Canvas assignment has no due date anywhere in this app, so the planner
 * scheduled homework the night before a unit test it had never heard of.
 *
 * ## What "anyone with the link" buys us
 *
 * Published Google files answer an unauthenticated export request. That is the
 * only reason this can work without OAuth, and it is also the whole limit of
 * it: a document shared only with the class, or restricted to the district
 * domain, returns a sign-in page instead. That case is detected and reported,
 * never guessed at — see `looksLikeSignIn`.
 *
 * Pure link-handling and fetching. No Prisma, no model, no `server-only`, so
 * the URL parsing can be tested on its own.
 */

/** Google file kinds worth reading, and how each exports as text. */
const EXPORTS: { kind: string; path: string; format: string }[] = [
  { kind: "document", path: "document", format: "txt" },
  // Assessment plans are very often a spreadsheet — one row per unit, a column
  // of dates. CSV keeps the row structure, which the extractor needs.
  { kind: "spreadsheets", path: "spreadsheets", format: "csv" },
];

export interface GoogleFileRef {
  /** The file id from the URL. */
  id: string;
  /** "document" or "spreadsheets". */
  kind: string;
  /** The URL it was found at, for reporting. */
  href: string;
}

/**
 * Every distinct Google Doc or Sheet linked in a blob of HTML or text.
 *
 * Deduplicated by file id, because a teacher links the same assessment plan
 * from the syllabus page, a module and an announcement, and fetching it three
 * times would cost three model calls to learn the same dates.
 */
/**
 * Google links with the words that were linked.
 *
 * The anchor text is usually the only thing that says what a document is — a
 * teacher's Home page linking "Assessment Plan" is the common case, and gating
 * on the *page* title alone misses it entirely. Falls back to the bare file
 * list for HTML with no anchors (a Canvas item url, plain text).
 */
export function findGoogleLinksWithText(
  html: string,
): { file: GoogleFileRef; text: string }[] {
  const out: { file: GoogleFileRef; text: string }[] = [];
  const seen = new Set<string>();

  for (const anchor of html.matchAll(
    /<a\b[^>]*href=["']([^"']*docs\.google\.com[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const [, href, inner] = anchor;
    const [file] = findGoogleFiles(href);
    if (!file || seen.has(file.id)) continue;

    seen.add(file.id);
    out.push({
      file,
      text: inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    });
  }

  // Bare urls with no anchor around them still count.
  for (const file of findGoogleFiles(html)) {
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    out.push({ file, text: "" });
  }

  return out;
}

export function findGoogleFiles(html: string): GoogleFileRef[] {
  const found = new Map<string, GoogleFileRef>();

  const pattern =
    /https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9_-]{20,})/g;

  for (const match of html.matchAll(pattern)) {
    const [href, kind, id] = match;

    // Presentations have no reliable text export; recording the link without
    // pretending it can be read is more honest than a silent skip.
    if (!EXPORTS.some((entry) => entry.kind === kind)) continue;

    if (!found.has(id)) found.set(id, { id, kind, href });
  }

  return [...found.values()];
}

/**
 * Does the surrounding text suggest this link is a schedule worth parsing?
 *
 * Teachers link plenty of Google files that are not calendars — a note-taking
 * template, a lab writeup form, a seating chart. Parsing all of them would burn
 * a model call each and invite the extractor to invent dates out of a document
 * that has none. So a link has to be introduced by something schedule-shaped.
 */
const SCHEDULE_WORDS =
  /\b(assessment plan|assessment calendar|scope and sequence|syllabus|course outline|unit plan|unit calendar|pacing|test dates?|calendar|schedule|important dates?|key dates?)\b/i;

export function looksLikeSchedule(context: string): boolean {
  return SCHEDULE_WORDS.test(context);
}

/** A Google sign-in page, which is what a restricted file returns. */
export function looksLikeSignIn(text: string): boolean {
  return (
    /accounts\.google\.com/i.test(text) ||
    /sign in to continue/i.test(text) ||
    /request access/i.test(text) ||
    /you need permission/i.test(text)
  );
}

export class GoogleDocError extends Error {
  constructor(
    message: string,
    readonly kind: "restricted" | "network" | "empty",
  ) {
    super(message);
    this.name = "GoogleDocError";
  }
}

/** A published document is small; a hung fetch should still give up. */
const TIMEOUT_MS = 20_000;

/** Enough for a year's assessment plan, bounded so one file can't blow a prompt. */
const MAX_CHARS = 60_000;

/**
 * The text of a published Google file.
 *
 * Throws rather than returning empty on a restricted file, because "the teacher
 * shared this with the class only" and "this document has no dates in it" need
 * completely different responses from the student and only one of them is
 * fixable.
 */
export async function fetchGoogleFileText(file: GoogleFileRef): Promise<string> {
  const entry = EXPORTS.find((option) => option.kind === file.kind);
  if (!entry) throw new GoogleDocError("Unsupported Google file type.", "empty");

  const url = `https://docs.google.com/${entry.path}/d/${file.id}/export?format=${entry.format}`;

  let response: Response;

  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // A bare fetch UA gets an interstitial from Google often enough to
        // matter, and this is the same dodge the HAC client makes.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
  } catch {
    throw new GoogleDocError(
      "Couldn't reach Google Docs. Check the network and try again.",
      "network",
    );
  }

  if (!response.ok) {
    throw new GoogleDocError(
      response.status === 403 || response.status === 401
        ? "That document isn't shared with anyone who has the link."
        : `Google returned ${response.status} for that document.`,
      response.status === 403 || response.status === 401 ? "restricted" : "network",
    );
  }

  const text = (await response.text()).slice(0, MAX_CHARS);

  /*
   * A restricted file answers 200 with a sign-in page, exactly the way HAC
   * answers a failed login with the login form. Without this check, the
   * extractor would be handed Google's chrome and asked to find test dates in
   * it — and would report finding none, which reads as "the teacher hasn't
   * posted any" rather than "you can't see this".
   */
  if (looksLikeSignIn(text)) {
    throw new GoogleDocError(
      "That document is not shared publicly — it opens a Google sign-in.",
      "restricted",
    );
  }

  if (text.trim().length < 80) {
    throw new GoogleDocError("That document had almost no text in it.", "empty");
  }

  return text;
}
