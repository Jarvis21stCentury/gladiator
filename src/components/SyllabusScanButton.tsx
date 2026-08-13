"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LinkedDocResult } from "@/lib/syllabus/ingest-linked";

/**
 * Find every class's assessment plan and read the test dates out of it.
 *
 * The report matters as much as the action. Three outcomes are genuinely
 * different and only one is fixable by the student: a document was parsed, a
 * document is not shared with anyone-with-the-link, or nothing schedule-shaped
 * was linked at all. Collapsing those into "done" would leave someone staring
 * at a class with no test dates and no idea why.
 */
export function SyllabusScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{
    line: string;
    restricted: LinkedDocResult[];
  } | null>(null);

  async function run(force: boolean) {
    setBusy(true);
    setReport(null);

    try {
      const response = await fetch(
        `/api/syllabus/scan${force ? "?force=1" : ""}`,
        { method: "POST" },
      );
      const body = await response.json();

      if (!response.ok) {
        setReport({ line: body.error ?? "Scan failed.", restricted: [] });
        return;
      }

      const results: LinkedDocResult[] = body.results ?? [];
      const restricted = results.filter((row) => row.status === "restricted");
      const failed = results.filter((row) => row.status === "failed");

      setReport({
        line:
          body.documentsFound === 0
            ? /* Zero is two different situations and the student can only act
                 on one of them, so the counts say which. */
              body.googleLinksSeen === 0
              ? `Checked ${body.coursesScanned} classes and ${body.pagesScanned} pages — no Google Docs linked in Canvas at all.`
              : `Checked ${body.coursesScanned} classes and ${body.pagesScanned} pages. Found ${body.googleLinksSeen} Google links, none of them named like a schedule.`
            : [
                `Read ${body.documentsParsed} of ${body.documentsFound} document(s).`,
                body.datesWritten > 0 ? `${body.datesWritten} dates added.` : null,
                failed.length > 0 ? `${failed.length} failed.` : null,
              ]
                .filter(Boolean)
                .join(" "),
        restricted,
      });

      router.refresh();
    } catch (error) {
      setReport({
        line: error instanceof Error ? error.message : String(error),
        restricted: [],
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={busy}
          className="control"
          data-active="true"
        >
          {busy ? "Reading…" : "Find test dates in Canvas"}
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy}
          className="control"
        >
          Re-read all
        </button>
      </div>

      {report ? (
        <>
          <p className="docket">{report.line}</p>

          {/* Named individually, because "shared with the class only" is a
              thing the student can go and ask their teacher to change, and a
              count would not tell them which class to ask about. */}
          {report.restricted.length > 0 ? (
            <p className="docket leading-relaxed">
              Not shared publicly:{" "}
              {report.restricted
                .map((row) => `${row.courseName} — ${row.label}`)
                .join("; ")}
              .
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
