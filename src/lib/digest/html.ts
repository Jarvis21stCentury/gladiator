/**
 * Canvas hands over HTML; the model and the day-slicer both want readable text.
 *
 * Pure and deliberately not `server-only`: it lived inside `ingest-canvas.ts`,
 * which is, and that meant nothing could parse a page body without dragging
 * Prisma and the Canvas client in behind it — including the tests for
 * `coursework.ts`, which are the whole reason day-slicing can be trusted.
 *
 * The line breaks matter more than they look. Block-level closes become
 * newlines because `sliceDay` finds a day's section by looking for a *line*
 * that names the date; collapse the markup to one long string and every dated
 * heading merges into the paragraph after it.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    /*
     * The punctuation a rich-text editor produces.
     *
     * Canvas's editor emits these constantly and the original list stopped at
     * &#39;, so a perfectly ordinary bullet — "Practice Set 1.1 &mdash; due
     * Monday" — reached the model with the entity still in it. Harmless to a
     * reader, noise to a parser, and it is the em dash that most often carries
     * the due date.
     */
    .replace(/&(mdash|ndash);/g, "—")
    .replace(/&(lsquo|rsquo|apos);/g, "'")
    .replace(/&(ldquo|rdquo);/g, '"')
    .replace(/&hellip;/g, "…")
    .replace(/&(deg|middot|bull);/g, " ")
    // Numeric entities, decimal and hex, for everything not named above.
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The same text, with each link's destination kept inline as `⟨url⟩`.
 *
 * `htmlToText` throws hrefs away, and for a coursework page that is the one
 * thing that must survive. Those pages link a slide deck per lesson *day*, so
 * knowing which deck belongs to today means knowing which links sat inside
 * today's section — and once the markup is gone, every deck on the page looks
 * equally current. Marking them inline lets the day-slicer carry them along
 * with the text it selects.
 *
 * The angle-quote markers are deliberate: they are not characters a teacher
 * types, so `stripLinkMarkers` can remove them again without eating real
 * punctuation. A url makes a line long, which also keeps it from being mistaken
 * for a dated heading — those are capped at 90 characters.
 */
export function htmlToTextWithLinks(html: string): string {
  const marked = html.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => `${inner} ⟨${href}⟩`,
  );

  return htmlToText(marked);
}

/** Remove the `⟨url⟩` markers again, for text a person or a model will read. */
export function stripLinkMarkers(text: string): string {
  return text.replace(/\s*⟨[^⟩]*⟩/g, "").replace(/[ \t]{2,}/g, " ");
}
