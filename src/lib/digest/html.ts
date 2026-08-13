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
