import Link from "next/link";

import { AutoSync } from "@/components/AutoSync";
import { GoogleCalendarButton } from "@/components/GoogleCalendarButton";
import { HacButton } from "@/components/HacButton";
import { PlanGenerateButton } from "@/components/PlanGenerateButton";
import { SyncButton } from "@/components/SyncButton";
import { TaskForm } from "@/components/TaskForm";
import { TaskRowActions } from "@/components/TaskRowActions";
import { Docket, DocketRow } from "@/components/press/Docket";
import { Figure } from "@/components/press/Figure";
import { Mark } from "@/components/press/Mark";
import { Meter } from "@/components/press/Meter";
import { PageHeader, type PageSection } from "@/components/press/PageHeader";
import { Plate } from "@/components/press/Plate";
import { PressureChart } from "@/components/press/PressureChart";
import { NowPanel } from "@/components/press/NowPanel";
import { Schedule } from "@/components/press/Schedule";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import { Verdict } from "@/components/press/Verdict";
import { getCourseTrends } from "@/lib/analytics/trend";
import { getDashboardData, type DueItem } from "@/lib/dashboard";
import { minutesLabel } from "@/lib/format";
import { getTodaysPlan } from "@/lib/planner/daily-plan";
import { STATUS_VAR } from "@/lib/status";
import { getSystemState } from "@/lib/system-state";
import { isOwnedTask } from "@/lib/tasks/ownership";

/**
 * The front page.
 *
 * Composed as a broadsheet, but structured so it can be *used*: a purpose line,
 * a contents list that jumps, and six numbered sections that each say what they
 * are before showing it. The earlier version led with a dateline and one
 * beautiful headline and left you to scroll blind to find out what the page even
 * contained — which is lovely and useless on a tool you open to check whether
 * something is due today.
 */

export const dynamic = "force-dynamic";

/** How stale the data has to be before opening the front page triggers a refresh. */
const STALE_AFTER_MINUTES = 30;

function DueBlock({
  heading,
  items,
  empty,
  ink,
}: {
  heading: string;
  items: DueItem[];
  empty: string;
  ink?: string;
}) {
  return (
    <div className="mt-10 first:mt-0">
      <p className="rubric mb-3" style={ink ? { color: ink } : undefined}>
        {heading} — {items.length}
      </p>

      {items.length === 0 ? (
        <p className="docket py-2">{empty}</p>
      ) : (
        <Docket>
          {items.map((item) => (
            <DocketRow
              key={item.id}
              title={item.title}
              meta={item.courseName}
              dueAt={item.dueAt}
              assignmentId={item.id}
              difficulty={item.difficulty}
              trailing={
                item.pointsPossible !== null ? `${item.pointsPossible} pts` : null
              }
              /* Only rows you own get controls — Canvas owns `submitted` on its
                 own rows. The presence of the controls is also how a task you
                 added, or one read off a teacher's page, tells itself apart
                 from one Canvas sent. */
              action={
                isOwnedTask(item.source) ? (
                  <TaskRowActions id={item.id} done={false} title={item.title} />
                ) : null
              }
            />
          ))}
        </Docket>
      )}
    </div>
  );
}

export default async function FrontPage() {
  const [
    {
      dueToday,
      dueThisWeek,
      upcoming,
      overdue,
      courses,
      lastCanvasSync,
      lastCalendarSync,
    },
    plan,
    system,
    trends,
  ] = await Promise.all([
    getDashboardData(),
    getTodaysPlan(),
    getSystemState(),
    getCourseTrends(),
  ]);

  const onFallback = lastCanvasSync?.mode === "ICAL_FALLBACK";
  const today = system.forecast.days[0];
  const dateline = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Breaks and dinner are rows in the schedule but are not things you complete,
  // so the progress count is over work blocks only.
  const planWork = plan?.tasks.filter((task) => task.kind === "WORK") ?? [];
  const planWorkCount = planWork.length;
  const planDone = planWork.filter((task) => task.done).length;
  const hasFlags = system.struggles.length > 0;

  // Built from what's actually on the page — a contents list that offers a
  // section which isn't rendered is worse than no contents list.
  const contents: PageSection[] = [
    { id: "now", label: "Right now" },
    { id: "workload", label: "Next two weeks" },
    ...(hasFlags ? [{ id: "flags", label: "Needs attention" }] : []),
    { id: "plan", label: "Today's plan" },
    { id: "due", label: "Everything due" },
    { id: "grades", label: "Grades" },
  ];

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow={dateline}
        title="Front page"
        purpose="What's due, what's slipping, and where the next two weeks get heavy."
        meta={
          <p className="rubric flex items-center gap-2.5">
            <Mark level={system.level} />
            {system.struggleCount > 0
              ? `${system.struggleCount} open flag${system.struggleCount === 1 ? "" : "s"}`
              : "no open flags"}
          </p>
        }
        contents={contents}
      />

      {/* ===================== 01 · RIGHT NOW ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="now"
          serial="01"
          rubric="The short answer"
          title="Right now"
          description="The system's read on how school is going, and the five numbers behind it."
          level={system.level}
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />
          <div>
            {/* The first thing on the page, because it is the question the app
                gets opened to answer. Dates are serialised to ISO because a
                client component cannot receive a Date across the boundary. */}
            {plan && plan.tasks.length > 0 ? (
              <div className="mb-[var(--block)]">
                <NowPanel
                  blocks={plan.tasks.map((task) => ({
                    id: task.id,
                    kind: task.kind,
                    title: task.title,
                    reason: task.reason,
                    startAt: task.startAt?.toISOString() ?? null,
                    endAt: task.endAt?.toISOString() ?? null,
                    done: task.done,
                    courseName: task.assignment?.course.name ?? null,
                  }))}
                />
              </div>
            ) : null}

            <Verdict
              text={system.headline}
              level={system.level}
              className="display--lg max-w-[18ch]"
            />

            <Rule className="mt-[var(--block)]" />

            <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">
              <Figure
                label="Due today"
                value={String(dueToday.length)}
                tally={{ to: dueToday.length }}
                level={dueToday.length > 0 ? "warming" : undefined}
                size="lg"
              />
              <Figure
                label="Overdue"
                value={String(overdue.length)}
                tally={{ to: overdue.length }}
                level={overdue.length > 0 ? "urgent" : undefined}
                size="lg"
              />
              <Figure
                label="Next 4 days"
                value={minutesLabel(system.nearTermMinutes)}
                hint={`${Math.round(system.nearTermRatio * 100)}% of your free time`}
                size="lg"
              />
              <Figure
                label="Today's load"
                value={minutesLabel(today?.loadMinutes ?? 0)}
                level={today?.level}
                hint="work due today"
                size="lg"
              />
              <Figure
                label="Two weeks"
                value={minutesLabel(system.forecast.totalMinutes)}
                hint={`${system.forecast.overloadedDays.length} day${
                  system.forecast.overloadedDays.length === 1 ? "" : "s"
                } that won't fit`}
                size="lg"
              />
            </div>

            {onFallback ? (
              <div
                className="mt-[var(--block)]"
                style={{ "--status": STATUS_VAR.warming } as React.CSSProperties}
              >
                <Rule weight="status" />
                <p className="rubric mt-4" style={{ color: STATUS_VAR.warming }}>
                  Grades are not being collected
                </p>
                <p className="prose mt-3 text-[0.95rem]">
                  This came from the Canvas calendar feed, not the API, so due
                  dates are current but grades, points and submission status are
                  missing. Add a Canvas access token as{" "}
                  <code className="docket">CANVAS_TOKEN</code> to fix it.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ===================== 02 · WORKLOAD ===================== */}
      <section className="mt-[var(--section)]">
        <div className="sheet">
          <SectionHead
            id="workload"
            serial="02"
            rubric="Workload forecast"
            title="The next two weeks"
            description="Each day's work drawn against the hours you actually have free that day. Where a bar runs past its dashed line, the day doesn't fit."
            // The chart used to pin the page and scrub as you scrolled. It
            // doesn't any more, so this said to do something that no longer
            // works — point at a day instead.
            hint="Point at a day to read it."
            level={system.level}
            aside={
              <Link href="/calendar" data-slip="" className="control">
                See three weeks
              </Link>
            }
          />
        </div>

        <PressureChart
          days={system.forecast.days.map((day) => ({
            date: day.date,
            offset: day.offset,
            loadMinutes: day.loadMinutes,
            capacityMinutes: day.capacityMinutes,
            level: day.level,
            itemCount: day.items.length,
          }))}
          totalMinutes={system.forecast.totalMinutes}
        />

        {system.forecast.peak ? (
          <div className="sheet mt-[var(--block)]">
            <div className="hang">
              <span aria-hidden="true" className="hidden lg:block" />
              <div>
                <p className="rubric mb-5">The heaviest day ahead</p>
                <div className="grid gap-x-12 gap-y-8 lg:grid-cols-12">
                  <div className="lg:col-span-5">
                    <Plate as="p" className="display display--md">
                      {system.forecast.peak.date.toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </Plate>
                    <p className="prose mt-4 text-[0.95rem] text-ink-soft">
                      {minutesLabel(system.forecast.peak.loadMinutes)} of work
                      against {minutesLabel(system.forecast.peak.capacityMinutes)}{" "}
                      free. Starting some of it earlier is the only way it fits.
                    </p>
                  </div>

                  <div className="lg:col-span-7">
                    <Docket>
                      {system.forecast.peak.items.slice(0, 5).map((item) => (
                        <DocketRow
                          key={item.assignmentId}
                          title={item.title}
                          meta={item.courseName}
                          dueAt={item.dueAt}
                          trailing={minutesLabel(item.estimatedMinutes)}
                        />
                      ))}
                    </Docket>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ===================== 03 · FLAGS ===================== */}
      {hasFlags ? (
        <section className="band mt-[var(--section)] py-[var(--section)]">
          <div className="sheet">
            <SectionHead
              id="flags"
              serial="03"
              rubric="Struggles engine"
              title="Needs attention"
              description="Patterns the app found on its own: work missed in clusters, a grade sliding several checks running, a day that can't fit what's due on it."
              level={system.level}
            />

            <div className="hang">
              <span aria-hidden="true" className="hidden lg:block" />
              <div className="flex flex-col gap-[var(--block)]">
                {system.struggles.map((struggle, index) => (
                  <article
                    key={struggle.id}
                    style={
                      { "--status": STATUS_VAR[struggle.level] } as React.CSSProperties
                    }
                  >
                    <Rule weight="status" />
                    <div className="mt-5 flex gap-5">
                      <span className="serial shrink-0 text-[1.75rem] opacity-100">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <Plate as="h3" className="display display--sm">
                          {struggle.title}
                        </Plate>
                        <p className="prose mt-3">{struggle.description}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ===================== 04 · TODAY'S PLAN ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="plan"
          serial={hasFlags ? "04" : "03"}
          rubric="Daily plan"
          title="Today's plan"
          description="Built each morning from what's due, how long things actually take you, and the hours you have free — with breaks and dinner already in it."
          hint={plan ? "Tick work off as you finish it." : undefined}
          aside={
            plan ? (
              <span className="rubric">
                {planDone} of {planWorkCount} done
              </span>
            ) : null
          }
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />
          {plan ? (
            <div>
              <p className="prose prose--lead">{plan.generatedSummary}</p>

              <Rule className="my-10" />

              {plan.tasks.length === 0 ? (
                <p className="docket">No tasks scheduled today.</p>
              ) : (
                <Schedule blocks={plan.tasks} />
              )}

              <div className="mt-6">
                <PlanGenerateButton hasPlan />
              </div>

              <p className="docket mt-4">
                Written by {plan.provider}/{plan.model} ·{" "}
                {plan.updatedAt.toLocaleString()}
              </p>
            </div>
          ) : (
            <div>
              <p className="prose mb-4 text-ink-soft">
                No plan for today yet.
              </p>
              <PlanGenerateButton hasPlan={false} />
            </div>
          )}
        </div>
      </section>

      {/* ===================== 05 · EVERYTHING DUE ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="due"
          serial={hasFlags ? "05" : "04"}
          rubric="Manifest"
          title="Everything due"
          description="Every assignment you haven't submitted, grouped by how soon it lands — plus anything you've added yourself."
          level={overdue.length > 0 ? "urgent" : undefined}
        />

        {/* Adding comes before the lists on purpose: this is the one section
            you arrive at wanting to *write* something rather than read it. */}
        <div className="mb-[var(--block)]">
          <TaskForm courses={courses.map((c) => ({ id: c.id, name: c.name }))} />
        </div>

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />
          <div className="grid gap-x-12 gap-y-0 lg:grid-cols-2">
            <div>
              {overdue.length > 0 ? (
                <DueBlock
                  heading="Overdue"
                  items={overdue}
                  empty="Nothing overdue."
                  ink={STATUS_VAR.urgent}
                />
              ) : null}
              <DueBlock
                heading="Today"
                items={dueToday}
                empty="Nothing due today."
              />
            </div>

            <div>
              <DueBlock
                heading="Rest of this week"
                items={dueThisWeek}
                empty="Nothing else due this week."
              />
              <DueBlock
                heading="Further out"
                items={upcoming}
                empty="Nothing further out yet."
              />
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 06 · GRADES ===================== */}
      <section className="sheet mt-[var(--section)]">
        <SectionHead
          id="grades"
          serial={hasFlags ? "06" : "05"}
          rubric="Per class"
          title="Grades"
          description="Where each class stands, and how far it has moved in the last few weeks."
          aside={
            <Link href="/classes" data-slip="" className="control">
              Open a class
            </Link>
          }
        />

        <div className="hang">
          <span aria-hidden="true" className="hidden lg:block" />

          {courses.length === 0 ? (
            <p className="prose text-ink-soft">
              No classes yet. Press <strong>Sync Canvas</strong> at the bottom of
              this page to pull them in.
            </p>
          ) : (
            <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => {
                const trend = trends.find((entry) => entry.courseId === course.id);

                return (
                  <Meter
                    key={course.id}
                    percent={onFallback ? null : course.currentGradePercent}
                    label={course.name}
                    caption={
                      onFallback
                        ? "grades not collected"
                        : trend && trend.changePercent !== null
                          ? `${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent.toFixed(1)} pts recently`
                          : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ===================== DATA SOURCE ===================== */}
      <section className="sheet mt-[var(--section)]">
        <Rule />
        <div className="hang mt-6">
          <span aria-hidden="true" className="hidden lg:block" />
          <div>
            <p className="rubric mb-4">Where this data comes from</p>
            <div className="flex flex-col gap-3">
              <SyncButton />
              <HacButton />
              <GoogleCalendarButton />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4">
              <AutoSync
                lastSyncedAt={lastCanvasSync?.startedAt.toISOString() ?? null}
                staleAfterMinutes={STALE_AFTER_MINUTES}
              />
            </div>

            <p className="docket mt-5 max-w-xl leading-relaxed">
              {lastCanvasSync
                ? `Canvas ${lastCanvasSync.status.toLowerCase()} via ${lastCanvasSync.mode} · ${lastCanvasSync.startedAt.toLocaleString()}`
                : "Canvas never synced"}
              {" · "}
              {lastCalendarSync
                ? `Calendar ${lastCalendarSync.eventsCreated} created / ${lastCalendarSync.eventsUpdated} updated / ${lastCalendarSync.eventsSkipped} left alone`
                : "Calendar never synced"}
            </p>

            {lastCanvasSync?.error || lastCalendarSync?.error ? (
              <p className="docket mt-3" style={{ color: STATUS_VAR.urgent }}>
                {lastCanvasSync?.error ?? lastCalendarSync?.error}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
