import { deleteRoutineBlock, seedTypicalWeek } from "@/app/actions";
import { RoutineForm } from "@/components/RoutineForm";
import { Docket } from "@/components/press/Docket";
import { PageHeader } from "@/components/press/PageHeader";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import { minutesLabel } from "@/lib/format";
import { currentGradingPeriod, gradingPeriods } from "@/lib/grading-period";
import {
  formatClock12,
  freeMinutes,
  freeSpans,
  resolveDay,
} from "@/lib/routine/model";
import { getRoutine } from "@/lib/routine/routine";
import { getSchoolYear, toISO } from "@/lib/school-year";
import { SchoolYearForm } from "@/components/SchoolYearForm";

/**
 * The weekly routine.
 *
 * Everything else in this product answers "what is due". This one answers "when
 * are you actually free", and until it existed the planner had to guess: free
 * time was a single clock range from an env var, 16:00 to 21:30, the same for
 * everybody every day of the week. A schedule built on that is one you cannot
 * follow, and a schedule you cannot follow is one you stop opening.
 *
 * Laid out as the week itself rather than as a settings form: seven columns you
 * read across, each showing the day's blocks and — the number that matters —
 * how much of it is left. Setup screens that look like forms feel like chores;
 * this one should look like the thing it describes.
 */

export const dynamic = "force-dynamic";

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

/** Each kind gets its own ink, so a week is readable at a glance. */
const KIND_COLOR: Record<string, string> = {
  SLEEP: "var(--ink-faint)",
  SCHOOL: "var(--accent)",
  ACTIVITY: "var(--course-3)",
  PERSONAL: "var(--jade)",
};

export default async function RoutinePage() {
  const [routine, year] = await Promise.all([getRoutine(), getSchoolYear()]);
  const empty = routine.length === 0;
  const current = currentGradingPeriod(year);

  const week = DAYS.map((day) => {
    const resolved = resolveDay(routine, day.value);
    return {
      ...day,
      blocks: routine.filter((block) => block.dayOfWeek === day.value),
      free: freeMinutes(resolved),
      spans: freeSpans(resolved),
      resolved,
    };
  });

  const weeklyFree = week.reduce((sum, day) => sum + day.free, 0);

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow="Your normal week"
        title="Routine"
        purpose=""
        meta={
          <p className="rubric">
            {minutesLabel(weeklyFree)} free across the week
          </p>
        }
      />

      <section className="sheet mt-[var(--section)]">
        <SectionHead id="week" serial="01" rubric="Week" title="A normal week" />

        {empty ? (
          <div className="card mb-[var(--block)] p-4">
            <p className="text-[0.9375rem]">
              Nothing set up yet, so the planner is assuming you&apos;re free
              from 4:00 PM to 9:30 PM every day.
            </p>
            <p className="mt-1.5 text-[0.8125rem] text-ink-soft">
              Start from a typical school week and edit it, or add blocks below.
            </p>
            <form action={seedTypicalWeek} className="mt-3">
              <button type="submit" className="control" data-active="true">
                Start from a typical week
              </button>
            </form>
          </div>
        ) : null}

        <div className="mb-[var(--block)]">
          <RoutineForm />
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {week.map((day) => (
            <div key={day.value} className="card overflow-hidden">
              <div className="card__head">
                <p className="display display--sm">{day.label}</p>
                <p
                  className="docket text-[0.6875rem]"
                  style={{
                    color: day.free === 0 ? "var(--flare)" : undefined,
                  }}
                >
                  {day.free === 0 ? "no free time" : `${minutesLabel(day.free)} free`}
                </p>
              </div>

              <ul className="flex flex-col">
                {day.blocks.length === 0 ? (
                  <li className="px-3 py-2.5 text-[0.8125rem] text-ink-soft">
                    Nothing set — assuming 4:00–9:30 PM.
                  </li>
                ) : (
                  day.blocks.map((block) => (
                    <li
                      key={block.id}
                      className="flex items-center gap-2.5 border-b border-rule px-3 py-2 last:border-b-0"
                    >
                      <span
                        className="chip"
                        style={{ "--course": KIND_COLOR[block.kind] } as React.CSSProperties}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                        {block.label}
                      </span>
                      <span className="docket shrink-0 text-[0.6875rem]">
                        {formatClock12(block.startMinutes)}–
                        {formatClock12(block.endMinutes)}
                      </span>
                      <form action={deleteRoutineBlock} className="shrink-0">
                        <input type="hidden" name="blockId" value={block.id} />
                        <button
                          type="submit"
                          aria-label={`Remove ${block.label} on ${day.label}`}
                          title="Remove"
                          className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors duration-150 hover:bg-paper-deep hover:text-[color:var(--flare)]"
                        >
                          <span className="text-[0.75rem] leading-none">×</span>
                        </button>
                      </form>
                    </li>
                  ))
                )}
              </ul>

              {day.spans.length > 0 ? (
                <p className="border-t border-rule px-3 py-2 text-[0.6875rem] text-ink-soft">
                  Free:{" "}
                  {day.spans
                    .map(
                      (span) =>
                        `${formatClock12(span.startMinutes)}–${formatClock12(span.endMinutes)}`,
                    )
                    .join(", ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-[var(--section)]">
          <SectionHead id="year" serial="02" rubric="Term" title="School year" />
          <SchoolYearForm
            start={toISO(year.start)}
            end={toISO(year.end)}
            configured={year.configured}
          />

          {/*
            The four nine weeks these dates produce, shown so the derivation is
            checkable rather than a black box. The Classes page scopes itself to
            whichever one contains today and rolls over on its own; if a
            boundary looks wrong, the fix is the two dates above, not a setting
            per quarter. See lib/grading-period.ts for why they are derived.
          */}
          <div className="mt-6">
            <p className="rubric mb-2">Nine weeks</p>
            <Docket>
              {gradingPeriods(year).map((period) => {
                const here = period.index === current.index;

                return (
                  <li
                    key={period.index}
                    className="flex items-baseline gap-3 border-b border-rule/70 py-2 last:border-b-0"
                  >
                    <span
                      className="min-w-0 flex-1 text-[0.875rem]"
                      style={here ? { color: "var(--accent)" } : undefined}
                    >
                      {period.label}
                      {here ? " · now" : ""}
                    </span>
                    <span className="docket text-[0.6875rem] opacity-70">
                      {period.start.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      –{" "}
                      {period.end.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </li>
                );
              })}
            </Docket>
          </div>
        </div>

        <Rule className="mt-[var(--section)]" />
        <p className="docket mt-4 max-w-2xl leading-relaxed">
          This is what the daily schedule and the two-week forecast are built
          from. Anything on your Google Calendar is subtracted on top — the
          routine is what happens every week, the calendar is what happens this
          week.
        </p>
      </section>
    </main>
  );
}
