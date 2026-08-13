import Link from "next/link";

import { DigestGenerateButton } from "@/components/DigestGenerateButton";
import { TextbookUpload } from "@/components/TextbookUpload";
import { Docket } from "@/components/press/Docket";
import { PageHeader } from "@/components/press/PageHeader";
import { Plate } from "@/components/press/Plate";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import { formatSchoolDay, parseSchoolDay } from "@/lib/digest/day";
import { getDigestForDay } from "@/lib/digest/generate";
import { serial } from "@/lib/format";
import { STATUS_VAR } from "@/lib/status";

/**
 * The nightly digest.
 *
 * This and the retro are the two pages that get *read* rather than scanned, and
 * CLAUDE.md's rules bite hardest here: body copy in the body face, a plain
 * readable measure, and nothing that gets between the reader and the words at
 * 11pm. So the workbook's instrument furniture is dropped entirely — no figures,
 * no meters, no charts — and the page keeps only the two devices it shares with
 * everything else: rules, and the hanging margin.
 *
 * The margin is what makes it structurally different from the front page rather
 * than just quieter. The class name, its serial and its provenance sit out in
 * the gutter and stay there while you read, so the notes themselves run in one
 * uninterrupted column with nothing else in it.
 */

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  CANVAS_MODULE_ITEM: "Canvas",
  CANVAS_ANNOUNCEMENT: "Announcement",
  TEXTBOOK_IMAGE: "Textbook photo",
  TEXTBOOK_PDF: "Textbook PDF",
};

function shiftDay(day: Date, days: number): string {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + days);
  return formatSchoolDay(next);
}

export default async function NightlyDigestPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; course?: string }>;
}) {
  const params = await searchParams;
  const day = parseSchoolDay(params.date ?? null);
  const { notes, pendingSources, courses, course, otherDay } =
    await getDigestForDay(day, params.course || undefined);

  const dateParam = formatSchoolDay(day);

  // Keep the class filter across the day nav, or paging back would silently
  // drop it and land the reader in every class at once.
  const withCourse = (date: string) =>
    course ? `/digest?date=${date}&course=${course.id}` : `/digest?date=${date}`;
  const readableDate = day.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const pendingByCourse = new Map<string, typeof pendingSources>();
  for (const source of pendingSources) {
    const bucket = pendingByCourse.get(source.course.name) ?? [];
    bucket.push(source);
    pendingByCourse.set(source.course.name, bucket);
  }

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow={course ? `${course.name} · ${readableDate}` : readableDate}
        title="Nightly digest"
        purpose="Each night, the new material from your classes cut down to key points, so you read the notes instead of the textbook."
        meta={
          <nav className="flex flex-wrap items-center gap-2">
            <Link href={withCourse(shiftDay(day, -1))} className="control">
              ← Prev day
            </Link>
            <Link href={course ? `/digest?course=${course.id}` : "/digest"} className="control">
              Today
            </Link>
            <Link href={withCourse(shiftDay(day, 1))} className="control">
              Next day →
            </Link>
            {course ? (
              <Link href={`/digest?date=${dateParam}`} className="control">
                All classes
              </Link>
            ) : null}
          </nav>
        }
        contents={[
          { id: "notes", label: "Tonight's notes" },
          { id: "intake", label: "Add textbook pages" },
          ...(pendingSources.length > 0
            ? [{ id: "waiting", label: "Not yet distilled" }]
            : []),
        ]}
      />

      {/* ===================== 01 · THE NOTES ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="notes"
          serial="01"
          rubric={`${notes.length} ${notes.length === 1 ? "class" : "classes"} distilled`}
          title="Tonight's notes"
          description="Key points per class, written from new Canvas material and any textbook pages you add below."
          size="md"
          aside={
            <DigestGenerateButton
              date={dateParam}
              label={
                notes.length === 0
                  ? "Build tonight's digest"
                  : "Pick up new material"
              }
            />
          }
        />

        {notes.length === 0 ? (
          <div className="hang">
            <span aria-hidden="true" className="hidden lg:block" />
            <p className="prose text-ink-soft">
              {course && otherDay ? (
                <>
                  Nothing for {course.name} on this day. Its most recent notes
                  are from{" "}
                  <Link
                    href={`/digest?date=${formatSchoolDay(otherDay)}&course=${course.id}`}
                    className="link"
                  >
                    {otherDay.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </Link>
                  .
                </>
              ) : course ? (
                /* Arrived from a class that has never had a digest built. The
                   generic line below would tell them to wait for something that
                   only happens when they press the button above it. */
                <>
                  No notes for {course.name}{" "}
                  yet. Build tonight&apos;s digest above and its flashcards can
                  be made from it.
                </>
              ) : (
                "Canvas content is pulled automatically each evening. Add textbook pages below if you want them included."
              )}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col">
          {notes.map((note, noteIndex) => {
            const pending = pendingByCourse.get(note.course.name) ?? [];

            return (
              <article
                key={note.id}
                className="hang border-t border-rule pt-10 first:border-t-0 first:pt-0 [&+&]:mt-12"
              >
                {/* The margin note. Sticky, so the class stays named while you
                    read its notes — the one piece of chrome allowed next to
                    prose. */}
                <aside className="mb-6 lg:mb-0">
                  <div className="lg:sticky lg:top-24">
                    <p className="serial hidden lg:block" aria-hidden="true">
                      {serial(noteIndex + 1)}
                    </p>
                  </div>
                </aside>

                <div>
                  <p className="rubric">
                    <span className="lg:hidden">{serial(noteIndex + 1)} · </span>
                    {note.sources.length > 0
                      ? note.sources
                          .map(
                            (source) =>
                              `${SOURCE_LABELS[source.kind] ?? source.kind} — ${source.label}`,
                          )
                          .join(" · ")
                      : (note.rawInputRef ?? "unknown source")}
                  </p>

                  <Plate as="h3" className="display display--md mt-2">
                    {note.course.name}
                  </Plate>

                  {pending.length > 0 ? (
                    <p
                      className="docket mt-3"
                      style={{ color: STATUS_VAR.warming }}
                    >
                      {pending.length} newer upload
                      {pending.length === 1 ? "" : "s"} not yet included.
                    </p>
                  ) : null}

                  <p className="prose prose--lead mt-7">
                    {note.generatedSummary}
                  </p>

                  <Rule className="my-8" />

                  {note.keyPoints.length === 0 ? (
                    <p className="docket">No key points were extracted.</p>
                  ) : (
                    <Docket as="ol">
                      {note.keyPoints.map((point, index) => (
                        <li
                          key={`${note.id}-${index}`}
                          className="flex gap-5 border-b border-rule/70 py-4 last:border-b-0"
                        >
                          <span className="docket shrink-0 pt-1.5">
                            {serial(index + 1)}
                          </span>
                          <p className="prose">{point}</p>
                        </li>
                      ))}
                    </Docket>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {notes.length > 0 ? (
          <div className="hang mt-12">
            <span aria-hidden="true" className="hidden lg:block" />
            <DigestGenerateButton
              date={dateParam}
              force
              label="Rewrite all notes for this day"
            />
          </div>
        ) : null}
      </section>

      {/* ===================== 02 · INTAKE ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="intake"
          serial="02"
          rubric="Intake"
          title="Add textbook pages"
          description="Canvas content is picked up automatically. Textbook pages aren't, so add them here and they'll be folded into tonight's notes."
          size="md"
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />
          <div>
            <p className="prose mb-8 text-[0.95rem] text-ink-soft">
              Photograph a page and the vision model reads it, or attach a PDF
              with a page range and the text is pulled straight out. Only the text
              is kept — the file itself isn&apos;t stored.
            </p>

            <TextbookUpload courses={courses} date={dateParam} />
          </div>
        </div>
      </section>

      {/* ===================== 03 · WAITING ===================== */}
      {pendingSources.length > 0 ? (
        <section className="sheet mt-[var(--section)]">
          <SectionHead
            id="waiting"
            serial="03"
            rubric={`${pendingSources.length} waiting`}
            title="Not yet distilled"
            description="Uploaded since the last run. Press “Pick up new material” above to include them."
            level="warming"
            size="md"
          />

          <div className="hang">
            <span aria-hidden="true" className="hidden lg:block" />
            <Docket>
              {pendingSources.map((source) => (
                <li
                  key={source.id}
                  className="flex flex-wrap items-baseline gap-x-4 border-b border-rule/70 py-3 last:border-b-0"
                >
                  <span className="text-[0.95rem]">{source.course.name}</span>
                  <span className="rubric">
                    {SOURCE_LABELS[source.kind] ?? source.kind}
                  </span>
                  <span className="docket">{source.label}</span>
                </li>
              ))}
            </Docket>
          </div>
        </section>
      ) : null}
    </main>
  );
}
