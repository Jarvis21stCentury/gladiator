import { permanentRedirect } from "next/navigation";

/**
 * Digest and Review became one page: `/study`.
 *
 * They were two halves of one loop — notes are written from the day's material,
 * cards are written from those notes — and splitting them across two nav items
 * meant the dependency was stated nowhere and acted on nowhere.
 *
 * Kept as a redirect rather than deleted because these URLs are in the
 * student's history and bookmarks, and the query string still means something
 * on the other side: `?course=` and `?date=` are carried straight through.
 */
export const dynamic = "force-dynamic";

export default async function DigestRedirect({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; course?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  if (params.date) query.set("date", params.date);
  if (params.course) query.set("course", params.course);

  permanentRedirect(query.size > 0 ? `/study?${query}` : "/study");
}
