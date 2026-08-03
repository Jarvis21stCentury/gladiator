import Link from "next/link";

import { Docket, DocketRow } from "@/components/press/Docket";
import { Figure } from "@/components/press/Figure";
import { Mark } from "@/components/press/Mark";
import { PageHeader } from "@/components/press/PageHeader";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import {
  formatDayParam,
  getDayDetail,
  getRail,
  parseDayParam,
} from "@/lib/calendar-view";
import { minutesLabel } from "@/lib/format";
import { STATUS_VAR } from "@/lib/status";

/**
 * The timetable.
 *
 * Composed as an almanac's weather table rather than as a chart: three ruled
 * staves of seven days, so the weekday columns line up and the fact that every
 * Thursday is brutal becomes visible on its own. Within each cell the day's work
 * is drawn as a bar across the cell and the hours actually free that day are a
 * tick on it — the same waterline reading as the front page, laid on its side.
 *
 * The grid and the chart earn their keep differently, which is why this page
 * does not simply repeat the front page's columns: a column chart shows you the
 * *shape* of a stretch of time, a grid shows you its *rhythm*.
 */

export const dynamic = "force-dynamic";

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const params = await searchParams;
  const selected = parseDayParam(params.day);

  const [rail, detail] = await Promise.all([getRail(), getDayDetail(selected)]);

  const selectedKey = formatDayParam(selected);
  const commitments = detail.commitments.filter(
    (commitment) => !commitment.isDeadlineMarker,
  );
  const markers = detail.commitments.filter(
    (commitment) => commitment.isDeadlineMarker,
  );

  const busiest = rail.reduce(
    (worst, day) => (day.loadRatio > worst.loadRatio ? day : worst),
    rail[0],
  );

  /*
   * Each cell is scaled against *its own* capacity rather than against the
   * busiest day in the window, which puts every waterline tick at the same
   * position in every cell — they line up into a rule running down the grid,
   * and a bar past it is instantly the thing your eye goes to.
   *
   * The alternative (one absolute scale across all 21 days) was tried first and
   * is worse here: one 5-hour day squashes every ordinary day into a two-pixel
   * smudge, so the grid stops answering the question it exists for.
   */
  const WATERLINE = 62; // percent of the cell width that means "a full day"

  // Pad to a whole week so the weekday columns align, starting on the rail's
  // own first weekday rather than assuming today is a Monday.
  const leadIn = rail.length > 0 ? rail[0].date.getDay() : 0;
  const weekdayNames = ["S", "M", "T", "W", "T", "F", "S"];

  const loadRatio = detail.forecast?.loadRatio ?? 0;

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow="Twenty-one days ahead"
        title="Timetable"
        purpose="Three weeks ahead, so an overloaded day stops being a surprise."
        meta={
          <p className="rubric">
            busiest:{" "}
            {busiest.date.toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}{" "}
            · {minutesLabel(busiest.loadMinutes)}
          </p>
        }
        contents={[
          { id: "grid", label: "Next 21 days" },
          { id: "day", label: "One day in detail" },
        ]}
      />

      {/* ===================== THE GRID ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="grid"
          serial="01"
          rubric="Three weeks"
          title="Next 21 days"
          description="Each cell is one day. The bar shows how full that day is; the tick marks a full day, so a bar past the tick is work that won't fit."
          hint="Click any day to open it below."
          level={busiest.level}
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />

          <div>
            <ol className="grid grid-cols-7 gap-px" aria-label="Next 21 days">
              {weekdayNames.map((name, index) => (
                <li
                  key={`head-${index}`}
                  className="rubric pb-2 text-center text-[0.5625rem]"
                  aria-hidden="true"
                >
                  {name}
                </li>
              ))}

              {Array.from({ length: leadIn }, (_, index) => (
                <li key={`lead-${index}`} aria-hidden="true" />
              ))}

              {rail.map((day) => {
                const isSelected = formatDayParam(day.date) === selectedKey;
                const isToday = day.offset === 0;
                const inked = day.level !== "calm" && day.loadMinutes > 0;

                const ratio =
                  day.capacityMinutes > 0
                    ? day.loadMinutes / day.capacityMinutes
                    : 0;
                // Work that fits, as a share of the cell; and the overflow,
                // capped so a wildly overloaded day can't run off the cell.
                const fitsWidth = Math.min(1, ratio) * WATERLINE;
                const overWidth =
                  Math.min(0.6, Math.max(0, ratio - 1)) * WATERLINE;

                return (
                  <li key={day.offset}>
                    <Link
                      href={`/calendar?day=${formatDayParam(day.date)}`}
                      aria-current={isSelected ? "page" : undefined}
                      aria-label={`${day.date.toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })} — ${minutesLabel(day.loadMinutes)} of work against ${minutesLabel(day.capacityMinutes)} free`}
                      className="group block border-t px-1.5 pb-4 pt-2 no-underline transition-colors duration-200"
                      style={{
                        borderTopColor: isSelected
                          ? "var(--ink)"
                          : "var(--rule)",
                        borderTopWidth: isSelected ? 2 : 1,
                        background: isSelected
                          ? "var(--paper-lift)"
                          : undefined,
                      }}
                    >
                      <span className="flex items-baseline justify-between">
                        <span
                          className="docket text-[0.6875rem]"
                          style={{
                            color: isToday || isSelected ? "var(--ink)" : undefined,
                            fontWeight: isToday ? 500 : undefined,
                          }}
                        >
                          {day.date.getDate()}
                        </span>
                        {day.items.length > 0 ? (
                          <span className="docket text-[0.5625rem] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            {day.items.length}
                          </span>
                        ) : null}
                      </span>

                      {/* The reading. Length and ink both carry it, so the grid
                          still works in greyscale. */}
                      <span className="relative mt-3 block h-[9px]">
                        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule-soft" />

                        <span
                          data-meter=""
                          className="absolute left-0 top-1/2 h-[4px] origin-left -translate-y-1/2"
                          style={{
                            width: `${fitsWidth}%`,
                            background: "var(--ink)",
                          }}
                        />

                        {overWidth > 0 ? (
                          <span
                            data-meter=""
                            className="absolute top-1/2 h-[4px] origin-left -translate-y-1/2"
                            style={{
                              left: `${WATERLINE}%`,
                              width: `${overWidth}%`,
                              background: STATUS_VAR.urgent,
                            }}
                          />
                        ) : null}

                        {/* The waterline — same place in every cell, so the
                            ticks line up into a rule down the grid. */}
                        <span
                          className="absolute top-0 h-full w-px bg-ink-faint"
                          style={{ left: `${WATERLINE}%` }}
                        />
                      </span>

                      <span className="mt-2 block">
                        <span
                          className="docket text-[0.5625rem]"
                          style={inked ? { color: STATUS_VAR[day.level] } : undefined}
                        >
                          {day.loadMinutes > 0
                            ? minutesLabel(day.loadMinutes)
                            : "—"}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>

            <p className="rubric mt-6">
              bar = how full the day is · tick = the whole day · vermilion = the
              part that does not fit
            </p>
          </div>
        </div>
      </section>

      {/* ===================== THE DAY SHEET ===================== */}
      <section className="sheet mt-[var(--section)]" key={selectedKey}>
        <SectionHead
          id="day"
          serial="02"
          rubric="Day sheet"
          title={selected.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
          description="Everything landing on the day you picked, and the time already committed on it."
          level={detail.level}
          aside={
            <span className="flex items-center gap-2.5">
              <Mark level={detail.level} />
              <span className="rubric">
                {detail.due.length} due · {commitments.length} committed
                {detail.forecast?.offset === 0 ? " · today" : ""}
              </span>
            </span>
          }
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />

          <div className="grid gap-x-12 gap-y-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              {/* The day's load as one figure — this page's single reading. */}
              <p
                className="fig--xl fig"
                style={
                  detail.forecast && detail.forecast.level !== "calm"
                    ? { color: STATUS_VAR[detail.forecast.level] }
                    : undefined
                }
              >
                {Math.round(loadRatio * 100)}
                <span className="display--md align-top opacity-40">%</span>
              </p>
              <p className="rubric mt-2">of the day&apos;s free time</p>

              <Rule className="my-8" />

              <div className="flex flex-wrap gap-x-10 gap-y-6">
                <Figure
                  label="Work due"
                  value={minutesLabel(detail.forecast?.loadMinutes ?? 0)}
                  level={detail.forecast?.level}
                />
                <Figure
                  label="Time free"
                  value={minutesLabel(detail.forecast?.capacityMinutes ?? 0)}
                  hint={
                    commitments.length > 0
                      ? `after ${commitments.length} commitment${commitments.length === 1 ? "" : "s"}`
                      : undefined
                  }
                />
                <Figure
                  label="Items"
                  value={String(detail.due.length)}
                  tally={{ to: detail.due.length }}
                />
              </div>
            </div>

            <div className="lg:col-span-4">
              <p className="rubric mb-3">Due this day</p>
              {detail.due.length === 0 ? (
                <p className="docket py-2">Nothing due.</p>
              ) : (
                <Docket>
                  {detail.due.map((item) => (
                    <DocketRow
                      key={item.id}
                      title={item.title}
                      meta={item.courseName}
                      dueAt={item.dueAt}
                      submitted={item.submitted}
                      level={item.level}
                      trailing={
                        item.pointsPossible !== null
                          ? `${item.pointsPossible} pts`
                          : null
                      }
                    />
                  ))}
                </Docket>
              )}
            </div>

            <div className="lg:col-span-4">
              <p className="rubric mb-3">Committed time</p>
              {commitments.length === 0 ? (
                <p className="docket py-2">
                  Nothing on the calendar — the whole study window is free.
                </p>
              ) : (
                <Docket>
                  {commitments.map((commitment) => (
                    <li
                      key={commitment.id}
                      className="flex items-baseline justify-between gap-4 border-b border-rule/70 py-3 last:border-b-0"
                      data-advance=""
                    >
                      <span className="text-[0.95rem] leading-snug">
                        {commitment.title}
                      </span>
                      <span className="docket shrink-0">
                        {commitment.start.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        –
                        {commitment.end.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </Docket>
              )}

              {markers.length > 0 ? (
                <p className="rubric mt-5 normal-case tracking-normal">
                  {markers.length} deadline marker
                  {markers.length === 1 ? "" : "s"} pushed to Google Calendar
                  {markers.some((marker) => marker.userModified)
                    ? " · some moved by hand and left alone"
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
