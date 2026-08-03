import Link from "next/link";

import { RetroGenerateButton } from "@/components/RetroGenerateButton";
import { Docket } from "@/components/press/Docket";
import { Figure } from "@/components/press/Figure";
import { Mark } from "@/components/press/Mark";
import { PageHeader } from "@/components/press/PageHeader";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import {
  gatherRetroFacts,
  getRetro,
  getWeekReplay,
  listRetroWeeks,
  weekStartOf,
} from "@/lib/retro/weekly";
import { AFFIRM_VAR, STATUS_VAR, type StatusLevel } from "@/lib/status";

/**
 * The weekly retro.
 *
 * The other page that is read rather than scanned, but composed the opposite way
 * round from the digest: the *evidence* comes first as a full-width week sheet,
 * and the prose resolves underneath it. You should have already seen the week
 * before anything tells you what it meant.
 *
 * The week sheet is an attendance register — seven ruled columns, one mark per
 * item, struck through where something was missed. It is the same ink language
 * as every docket in the product, zoomed out to a week.
 */

export const dynamic = "force-dynamic";

function weekParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftWeek(weekStart: Date, weeks: number): string {
  const next = new Date(weekStart);
  next.setUTCDate(next.getUTCDate() + weeks * 7);
  return weekParam(next);
}

function Findings({
  items,
  level,
  ink,
  empty,
}: {
  items: string[];
  level: StatusLevel;
  ink?: string;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="docket py-2">{empty}</p>;
  }

  return (
    <Docket>
      {items.map((item) => (
        <li
          key={item}
          className="flex gap-4 border-b border-rule/70 py-3.5 last:border-b-0"
          data-advance=""
          style={{ "--status": ink ?? STATUS_VAR[level] } as React.CSSProperties}
        >
          <span className="mt-2">
            <Mark level={level} ink={ink} />
          </span>
          <p className="prose text-[0.95rem]">{item}</p>
        </li>
      ))}
    </Docket>
  );
}

export default async function WeeklyRetroPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;

  const requested = params.week
    ? new Date(`${params.week}T12:00:00`)
    : new Date();
  const weekStart = weekStartOf(
    Number.isNaN(requested.getTime()) ? new Date() : requested,
  );

  const [retro, replay, facts, weeks] = await Promise.all([
    getRetro(weekStart),
    getWeekReplay(weekStart),
    gatherRetroFacts(weekStart),
    listRetroWeeks(),
  ]);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const rangeLabel = `${weekStart.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })} – ${weekEnd.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;

  const isCurrentWeek = weekStartOf().getTime() === weekStart.getTime();
  const busiest = Math.max(...replay.map((day) => day.items.length), 1);

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow={rangeLabel}
        title="Weekly retro"
        purpose="What got done, what got missed, and what to change next week."
        meta={
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href={`/retro?week=${shiftWeek(weekStart, -1)}`}
              className="control"
            >
              ← Prev week
            </Link>
            <Link href="/retro" className="control">
              This week
            </Link>
            {!isCurrentWeek ? (
              <Link
                href={`/retro?week=${shiftWeek(weekStart, 1)}`}
                className="control"
              >
                Next week →
              </Link>
            ) : null}
          </nav>
        }
        contents={[
          { id: "week", label: "What happened" },
          { id: "debrief", label: "Debrief" },
          ...(weeks.length > 0 ? [{ id: "archive", label: "Past weeks" }] : []),
        ]}
      />

      {/* ===================== 01 · THE WEEK SHEET ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="week"
          serial="01"
          rubric="Evidence"
          title="What happened"
          description="Every assignment due this week, one mark per item. A struck-through mark was missed. The figures underneath count it up."
          aside={
            <span className="rubric">struck = missed</span>
          }
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />

          <div>
            <ol className="grid grid-cols-7 gap-px">
              {replay.map((day) => (
                <li key={day.date.toISOString()} className="flex flex-col">
                  <span className="rubric pb-2 text-center text-[0.5625rem]">
                    {day.date.toLocaleDateString(undefined, {
                      weekday: "short",
                    })}
                  </span>

                  {/* `flex-1` so every column's marks column is the same
                      height and the date row lands on one baseline across the
                      week — otherwise a busy Wednesday pushes its own date
                      lower than the rest and the register stops being ruled. */}
                  <div
                    className="flex flex-1 flex-col-reverse items-center justify-start gap-2 border-t py-4"
                    style={{
                      minHeight: 44 + busiest * 16,
                      borderTopWidth: day.items.length > 0 ? 2 : 1,
                      borderTopColor:
                        day.items.length > 0
                          ? day.level === "calm"
                            ? "var(--ink)"
                            : STATUS_VAR[day.level]
                          : "var(--rule)",
                    }}
                  >
                    {day.items.length === 0 ? (
                      <span className="docket text-[0.5625rem] opacity-40">
                        —
                      </span>
                    ) : (
                      day.items.map((item) => (
                        <span key={item.id} data-press="">
                          <Mark
                            level={item.submitted ? "calm" : item.level}
                            shape={item.submitted ? undefined : "miss"}
                            label={`${item.title} (${item.courseName}): ${
                              item.submitted ? "submitted" : "missed"
                            }`}
                          />
                        </span>
                      ))
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-0.5 pt-2">
                    <span className="docket text-[0.6875rem]">
                      {day.date.getDate()}
                    </span>
                    {day.minutesLogged > 0 ? (
                      <span className="rubric text-[0.5rem]">
                        {Math.round(day.minutesLogged / 60)}h
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <Rule className="mt-10" />

            <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">
              <Figure
                label="Completed"
                value={String(facts.completed.length)}
                tally={{ to: facts.completed.length }}
                size="lg"
              />
              <Figure
                label="Missed"
                value={String(facts.missed.length)}
                tally={{ to: facts.missed.length }}
                level={facts.missed.length > 0 ? "urgent" : undefined}
                size="lg"
              />
              <Figure
                label="Time logged"
                value={`${Math.round(facts.minutesLogged / 60)}h`}
                tally={{ to: Math.round(facts.minutesLogged / 60), suffix: "h" }}
                hint={`${facts.loggedItems.length} items`}
                size="lg"
              />
              <Figure
                label="Plan tasks done"
                value={`${facts.planTasksDone}/${facts.planTasksTotal}`}
                size="lg"
              />
              <Figure
                label="Digests written"
                value={String(facts.lessonNoteCount)}
                tally={{ to: facts.lessonNoteCount }}
                size="lg"
              />
            </div>

            {facts.gradeMoves.length > 0 ? (
              <div className="mt-12">
                <p className="rubric mb-4">Grade movement</p>
                <Docket>
                  {facts.gradeMoves.map((move) => {
                    const up = move.to >= move.from;

                    return (
                      <li
                        key={move.courseName}
                        className="flex items-baseline justify-between gap-6 border-b border-rule/70 py-2.5 last:border-b-0"
                        data-advance=""
                      >
                        <span className="text-[0.95rem]">{move.courseName}</span>
                        <span
                          className="docket"
                          style={{ color: up ? AFFIRM_VAR : STATUS_VAR.warming }}
                        >
                          {move.from.toFixed(1)} → {move.to.toFixed(1)}%
                        </span>
                      </li>
                    );
                  })}
                </Docket>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ===================== 02 · THE DEBRIEF ===================== */}
      {retro ? (
        <>
          <section className="band mt-[var(--section)] py-[var(--section)]">
            <div className="sheet">
              <SectionHead
                id="debrief"
                serial="02"
                rubric="Interpretation"
                title="Debrief"
                description="Written from the numbers above, once the week is finished."
                aside={
                  <span className="docket">
                    {retro.provider}/{retro.model} ·{" "}
                    {retro.updatedAt.toLocaleDateString()}
                  </span>
                }
              />

              <div className="hang">
                <span aria-hidden="true" className="hidden lg:block" />
                {/* The one paragraph of the week, set large. */}
                <p className="prose prose--lead max-w-[48ch]">
                  {retro.summaryText}
                </p>
              </div>
            </div>
          </section>

          <section className="sheet mt-[var(--section)]">
            {/* `.hang` is a two-column grid, so it takes exactly two children:
                the rail and the content. A third wraps onto the next row *into
                the rail column* — which is how the rewrite button ended up
                88px wide and stacked over three lines. Everything after the
                rail goes inside one content wrapper. */}
            <div className="hang">
              <span aria-hidden="true" className="hidden lg:block" />

              <div>
              <div className="grid gap-x-12 gap-y-12 lg:grid-cols-3">
                <div>
                  <Rule />
                  <p className="rubric mt-4 mb-5" style={{ color: AFFIRM_VAR }}>
                    Wins — {retro.wins.length}
                  </p>
                  <Findings
                    items={retro.wins}
                    level="calm"
                    ink={AFFIRM_VAR}
                    empty="Nothing recorded."
                  />
                </div>

                <div>
                  <Rule />
                  <p
                    className="rubric mt-4 mb-5"
                    style={{ color: STATUS_VAR.warming }}
                  >
                    Struggles — {retro.struggles.length}
                  </p>
                  <Findings
                    items={retro.struggles}
                    level="warming"
                    empty="Nothing recorded."
                  />
                </div>

                <div>
                  <Rule />
                  <p className="rubric mt-4 mb-5">What to adjust</p>
                  <Findings
                    items={retro.adjustments}
                    level="calm"
                    empty="Nothing recorded."
                  />
                </div>
              </div>

                <div className="mt-12">
                  <RetroGenerateButton
                    week={weekParam(weekStart)}
                    label="Rewrite this retro"
                  />
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="sheet mt-[var(--section)]">
          <SectionHead
            id="debrief"
            serial="02"
            rubric="Interpretation"
            title="Not written yet"
            size="md"
          />
          <div className="hang">
            <span aria-hidden="true" className="hidden lg:block" />
            <div>
              <p className="prose text-ink-soft">
                {isCurrentWeek
                  ? "This week's retro is written on Sunday evening, once there is a finished week to describe. You can write it early from what has happened so far."
                  : "No retro was written for this week."}
              </p>
              <div className="mt-8">
                <RetroGenerateButton
                  week={weekParam(weekStart)}
                  label={isCurrentWeek ? "Write it now" : "Write this week's retro"}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===================== ARCHIVE ===================== */}
      {weeks.length > 0 ? (
        <section id="archive" className="sheet mt-[var(--section)] scroll-mt-20">
          <Rule />
          <div className="hang mt-5">
            <p className="rubric hidden lg:block">Past weeks</p>
            <ul className="flex flex-wrap gap-2">
              {weeks.map((week) => (
                <li key={week.toISOString()}>
                  <Link
                    href={`/retro?week=${weekParam(week)}`}
                    className="control"
                    data-active={
                      week.getTime() === weekStart.getTime() ? "true" : undefined
                    }
                  >
                    {week.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}
