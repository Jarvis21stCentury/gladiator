import Link from "next/link";

import { toggleCourseHidden } from "@/app/actions";

import { EffortLogForm } from "@/components/EffortLogForm";
import { CardGenerateButton } from "@/components/review/CardGenerateButton";
import { SyllabusUpload } from "@/components/SyllabusUpload";
import { Docket, DocketRow } from "@/components/press/Docket";
import { Figure } from "@/components/press/Figure";
import { Mark } from "@/components/press/Mark";
import { Meter } from "@/components/press/Meter";
import { PageHeader } from "@/components/press/PageHeader";
import { Plate } from "@/components/press/Plate";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import { CourseForm } from "@/components/CourseForm";
import { GradeEditor } from "@/components/GradeEditor";
import { TaskRowActions } from "@/components/TaskRowActions";
import { Trace } from "@/components/press/Trace";
import { getHiddenCourses, getClassViews, type ClassView } from "@/lib/classes";
import { getCalibration } from "@/lib/effort/estimate";
import { getDeckSummaries, type DeckSummary } from "@/lib/flashcards/deck";
import { gradeLabel, serial } from "@/lib/format";
import {
  GRADE_TARGETS,
  calculateWhatIf,
  type WhatIfResult,
} from "@/lib/grades/what-if";
import { STATUS_VAR, levelForGrade } from "@/lib/status";

/**
 * The ledger.
 *
 * Composed as a report rather than a dashboard: a standing table of every class
 * at the top — the one view where they can actually be compared — and then one
 * full dossier per class beneath it, each opened by its own rule and serial.
 *
 * The dossier hangs its grade in the margin as the largest thing on the spread,
 * because for a page called Classes that is the figure you came for. Everything
 * else (the trace, the what-if, the outstanding work) is evidence for it.
 */

export const dynamic = "force-dynamic";

const DEFAULT_TARGET = 87;

/**
 * Dossiers continue the page's numbering rather than restarting at 01: the
 * contents list at the top counts "01 All classes, 02 Set a grade target",
 * so the first class is 03. Two competing numbering schemes on one page is
 * exactly the kind of thing that makes a page feel disorganised.
 */
const DOSSIER_OFFSET = 3;

const TREND_MARK: Record<string, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
  unknown: "·",
};

function WhatIf({ result }: { result: WhatIfResult }) {
  const required = result.requiredPercent;

  const level =
    required === null
      ? undefined
      : required > 100
        ? ("urgent" as const)
        : required > 90
          ? ("warming" as const)
          : ("calm" as const);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        <Figure
          label={`Needed for ${result.targetPercent}%`}
          value={
            required === null
              ? "—"
              : required < 0
                ? "locked in"
                : `${Math.ceil(required)}%`
          }
          level={level}
          size="lg"
          hint={
            required !== null && required > 100
              ? "not reachable on the work that's left"
              : undefined
          }
        />
        {/*
          Replaced "Ungraded points". That was a points total over everything
          unmarked — mostly work not even due yet — which answered a question
          nobody asks. This is the one they do: how many grades are still
          coming.
        */}
        <Figure
          label="Waiting on a grade"
          value={String(result.awaitingGrade)}
          tally={{ to: result.awaitingGrade }}
          hint={
            result.awaitingGrade === 0
              ? "everything due is marked"
              : "handed in, past due, not marked yet"
          }
        />
        <Figure
          label="Basis"
          value={result.mode === "weighted" ? "weighted" : "flat points"}
          hint={
            result.mode === "weighted"
              ? "syllabus categories"
              : "approximate — no weights on record"
          }
        />
      </div>

      {result.note ? <p className="docket mt-5">{result.note}</p> : null}

      {result.mode === "weighted" ? (
        <Docket className="mt-7">
          {result.categories.map((category) => (
            <li
              key={category.name}
              /*
               * Wraps rather than squeezing. Four columns plus a category name is
               * wider than a phone once the gaps are counted, and the name is the
               * part that has to stay whole — so on a narrow screen it takes its
               * own line and the figures sit underneath it.
               */
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule/70 py-2.5 last:border-b-0"
            >
              <span className="w-full min-w-0 text-[0.95rem] sm:w-auto sm:flex-1">
                {category.name}
              </span>
              <span className="docket w-12 text-right">
                {category.weightPercent.toFixed(0)}%
              </span>
              <span
                className="docket w-16 text-right"
                style={
                  category.percent !== null
                    ? { color: STATUS_VAR[levelForGrade(category.percent)] }
                    : undefined
                }
              >
                {category.percent === null
                  ? "—"
                  : `${category.percent.toFixed(1)}%`}
              </span>
              <span className="docket w-20 text-right opacity-70">
                {Math.round(category.remainingPoints)} left
              </span>
            </li>
          ))}
        </Docket>
      ) : (
        <p className="prose mt-5 text-[0.95rem] text-ink-soft">
          Parse this class&apos;s syllabus below and this becomes a weighted
          answer instead of an even-points estimate.
        </p>
      )}
    </div>
  );
}

function Dossier({
  view,
  whatIf,
  index,
  deck,
}: {
  view: ClassView;
  whatIf: WhatIfResult | null;
  index: number;
  deck: DeckSummary | undefined;
}) {
  const trend = view.trend;
  const gradeLevel = levelForGrade(view.currentGradePercent);

  return (
    <article
      id={`course-${view.id}`}
      className="scroll-mt-24"
      style={{ "--status": STATUS_VAR[view.level] } as React.CSSProperties}
    >
      <Rule weight={view.level === "calm" ? "heavy" : "status"} />

      {/* The masthead of the spread: serial in the margin, name across the
          measure, grade hung to the right and set as the largest figure here. */}
      <div className="hang mt-7">
        <p className="serial hidden lg:block" aria-hidden="true">
          {serial(index + DOSSIER_OFFSET)}
        </p>

        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <p className="rubric">
              <span className="lg:hidden">{serial(index + DOSSIER_OFFSET)} · </span>
              {view.term ?? "class"}
            </p>
            <Plate as="h3" className="display display--lg mt-2">
              {view.name}
            </Plate>

            <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-2">
              <span className="flex items-center gap-2.5">
                <Mark level={view.level} />
                <span className="rubric">
                  {view.overdueCount > 0
                    ? `${view.overdueCount} overdue`
                    : "nothing overdue"}
                </span>
              </span>
              <span className="rubric">{view.upcoming.length} outstanding</span>
              {view.minutesLogged > 0 ? (
                <span className="rubric">
                  {Math.round(view.minutesLogged / 60)}h logged
                </span>
              ) : null}
            </div>
          </div>

          <div className="lg:col-span-5 lg:text-right">
            <p
              className="fig--xl fig"
              style={
                gradeLevel === "calm" ? undefined : { color: STATUS_VAR[gradeLevel] }
              }
            >
              {gradeLabel(view.currentGradePercent)}
            </p>
            <p className="rubric mt-2">current grade</p>
            <div className="mt-2 flex items-center gap-3 lg:justify-end">
              <GradeEditor
                courseId={view.id}
                courseName={view.name}
                percent={view.currentGradePercent}
                fromCanvas={view.fromCanvas}
              />
              {/* Not a delete: the next sync would recreate it. */}
              <form action={toggleCourseHidden}>
                <input type="hidden" name="courseId" value={view.id} />
                <button
                  type="submit"
                  className="text-[0.75rem] text-ink-soft underline underline-offset-2 hover:text-[color:var(--flare)]"
                >
                  Hide
                </button>
              </form>
            </div>
            {trend ? (
              <p
                className="docket mt-2"
                style={
                  trend.level === "calm" ? undefined : { color: STATUS_VAR[trend.level] }
                }
              >
                {TREND_MARK[trend.direction]}{" "}
                {trend.changePercent === null
                  ? "no trend yet"
                  : `${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent.toFixed(1)} pts`}
                {trend.consecutiveDrops >= 2
                  ? ` · down ${trend.consecutiveDrops} checks`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Flags */}
      {view.struggles.length > 0 ? (
        <div className="hang mt-9">
          <span aria-hidden="true" className="hidden lg:block" />
          <div className="flex flex-col gap-4">
            {view.struggles.map((struggle) => (
              <div
                key={struggle.id}
                className="flex gap-4"
                style={
                  { "--status": STATUS_VAR[struggle.level] } as React.CSSProperties
                }
              >
                <span className="mt-2">
                  <Mark level={struggle.level} />
                </span>
                <p className="prose text-[0.95rem]">
                  <span
                    className="display display--sm"
                    style={{ color: STATUS_VAR[struggle.level] }}
                  >
                    {struggle.title}.
                  </span>{" "}
                  {struggle.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* The trace — the widest thing in the dossier. */}
      <div className="hang mt-10">
        <p className="rubric hidden lg:block">Grade<br />over time</p>
        <div>
          <Trace points={trend?.points ?? []} level={trend?.level ?? "calm"} />
        </div>
      </div>

      {/* What-if and the manifest, side by side. */}
      <div className="hang mt-12">
        <span aria-hidden="true" className="hidden lg:block" />
        <div className="grid gap-x-12 gap-y-12 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <p className="rubric mb-1">
              What it takes to hit your target
            </p>
            <p className="prose mb-5 text-[0.9rem] text-ink-soft">
              Based on the points still ungraded in this class.
            </p>
            {whatIf ? <WhatIf result={whatIf} /> : null}
          </div>

          <div className="min-w-0 lg:col-span-7">
            <p className="rubric mb-3">Outstanding — {view.upcoming.length}</p>
            {view.upcoming.length === 0 ? (
              <p className="docket py-2">Nothing outstanding.</p>
            ) : (
              <Docket>
                {view.upcoming.map((assignment) => (
                  <DocketRow
                    key={assignment.id}
                    title={assignment.title}
                    meta={
                      assignment.categoryName || assignment.fromSyllabus
                        ? `${assignment.categoryName ?? ""}${
                            assignment.categoryName && assignment.fromSyllabus
                              ? " · "
                              : ""
                          }${assignment.fromSyllabus ? "from syllabus" : ""}`
                        : undefined
                    }
                    dueAt={assignment.dueAt}
                    level={assignment.level}
                    assignmentId={assignment.id}
                    difficulty={assignment.difficulty}
                    trailing={
                      <>
                        {assignment.pointsPossible !== null
                          ? `${assignment.pointsPossible} pts`
                          : "—"}{" "}
                        · ~{assignment.estimatedMinutes}m
                      </>
                    }
                    action={
                      assignment.source === "MANUAL" ? (
                        <TaskRowActions
                          id={assignment.id}
                          done={assignment.submitted}
                          title={assignment.title}
                        />
                      ) : null
                    }
                  />
                ))}
              </Docket>
            )}

            {view.recent.length > 0 ? (
              <>
                <p className="rubric mb-3 mt-9">Recently closed</p>
                <Docket>
                  {view.recent.map((assignment) => (
                    <DocketRow
                      key={assignment.id}
                      title={assignment.title}
                      dueAt={assignment.dueAt}
                      submitted={assignment.submitted}
                      level="calm"
                      trailing={
                        assignment.score !== null && assignment.pointsPossible
                          ? `${assignment.score}/${assignment.pointsPossible}`
                          : assignment.submitted
                            ? "submitted"
                            : "—"
                      }
                      /* The class dossier is where a completed task can be
                         un-ticked or deleted. Without this, marking one done on
                         the front page was a one-way trip: it vanished from
                         every list that filters on `submitted: false` and there
                         was nowhere left to change your mind. */
                      action={
                        assignment.source === "MANUAL" ? (
                          <TaskRowActions
                            id={assignment.id}
                            done={assignment.submitted}
                            title={assignment.title}
                          />
                        ) : null
                      }
                    />
                  ))}
                </Docket>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Review */}
      <div className="hang mt-12">
        <span aria-hidden="true" className="hidden lg:block" />
        <div className="border-t border-rule pt-8">
          <p className="rubric mb-1">Flashcards</p>
          <p className="prose mb-5 max-w-[52ch] text-[0.95rem] text-ink-soft">
            Written from this class&apos;s nightly notes and scheduled so a card
            comes back just before you&apos;d forget it.
          </p>

          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {deck && deck.due > 0 ? (
              <Link
                href={`/review/${view.id}`}
                className="control"
                data-active="true"
              >
                Review {deck.due} card{deck.due === 1 ? "" : "s"}
              </Link>
            ) : null}

            <span className="docket">
              {!deck || deck.total === 0
                ? "No cards yet."
                : `${deck.total} card${deck.total === 1 ? "" : "s"}${
                    deck.due === 0 && deck.nextDueAt
                      ? ` · next on ${deck.nextDueAt.toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}`
                      : ""
                  }`}
            </span>

            {deck && deck.uncardedNotes > 0 ? (
              <CardGenerateButton
                courseId={view.id}
                label={`Make cards from ${deck.uncardedNotes} note${deck.uncardedNotes === 1 ? "" : "s"}`}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Intake */}
      <div className="hang mt-12">
        <span aria-hidden="true" className="hidden lg:block" />
        <div className="grid gap-x-12 gap-y-10 border-t border-rule pt-8 lg:grid-cols-2">
          <div>
            <p className="rubric mb-5">Log effort</p>
            <EffortLogForm
              assignments={[...view.upcoming, ...view.recent].map((assignment) => ({
                id: assignment.id,
                title: assignment.title,
                estimatedMinutes: assignment.estimatedMinutes,
              }))}
            />
          </div>

          <div>
            <p className="rubric mb-5">Syllabus</p>
            <SyllabusUpload courseId={view.id} courseName={view.name} />

            {view.categories.length > 0 ? (
              <p className="docket mt-4 leading-relaxed">
                Weights on record:{" "}
                {view.categories
                  .map(
                    (category) =>
                      `${category.name} ${category.weightPercent.toFixed(0)}%`,
                  )
                  .join(", ")}
                .
              </p>
            ) : null}

            {view.lastSyllabusImport ? (
              <p className="docket mt-2">
                last parsed{" "}
                {view.lastSyllabusImport.createdAt.toLocaleDateString()} —{" "}
                {view.lastSyllabusImport.fileName}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  const params = await searchParams;

  const parsed = Number(params.target);
  const target =
    Number.isFinite(parsed) && parsed > 0 && parsed <= 150
      ? parsed
      : DEFAULT_TARGET;

  const [views, calibration, decks, hidden] = await Promise.all([
    getClassViews(),
    getCalibration(),
    getDeckSummaries(),
    getHiddenCourses(),
  ]);

  const whatIfs = await Promise.all(
    views.map((view) =>
      calculateWhatIf({ courseId: view.id, targetPercent: target }),
    ),
  );

  const totalOutstanding = views.reduce(
    (sum, view) => sum + view.upcoming.length,
    0,
  );
  const totalOverdue = views.reduce((sum, view) => sum + view.overdueCount, 0);

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow={`${views.length} classes · ${totalOutstanding} outstanding`}
        title="Classes"
        purpose="One dossier per class: your grade, where it's heading, and everything still outstanding."
        meta={
          totalOverdue > 0 ? (
            <p className="rubric" style={{ color: STATUS_VAR.urgent }}>
              {totalOverdue} overdue
            </p>
          ) : (
            <p className="rubric">nothing overdue</p>
          )
        }
        contents={[
          { id: "standing", label: "All classes" },
          { id: "target", label: "Set a grade target" },
          ...views.map((view) => ({
            id: `course-${view.id}`,
            label: view.name,
          })),
        ]}
      />

      {views.length === 0 ? (
        <section className="sheet mt-[var(--section)]">
          <Rule />
          <div className="hang mt-6">
            <span aria-hidden="true" className="hidden lg:block" />
            <p className="prose text-ink-soft">
              Nothing synced yet. Run a sync from{" "}
              <Link href="/" data-slip="" className="link">
                the front page
              </Link>
              .
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* ===================== 01 · THE STANDING ===================== */}
          <section className="band mt-[var(--section)] py-[var(--section)]">
            <div className="sheet">
              <SectionHead
                id="standing"
                serial="01"
                rubric="Standing"
                title="All classes"
                description="Every class on the same scale, so you can see which one needs the time."
                hint="Click a class to jump to its full dossier."
              />

              {/* Adding a class comes first when there are none: with no
                  classes there is nothing to compare, and every task in the
                  product has to belong to one. */}
              <div className="mb-[var(--block)]">
                <CourseForm />
              </div>

              {hidden.length > 0 ? (
                <div className="mb-[var(--block)] flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="rubric">Hidden</span>
                  {hidden.map((course) => (
                    <form key={course.id} action={toggleCourseHidden}>
                      <input type="hidden" name="courseId" value={course.id} />
                      <button
                        type="submit"
                        title="Show this class again"
                        className="rounded border border-rule px-2 py-0.5 text-[0.75rem] text-ink-soft hover:border-[color:var(--accent)] hover:text-accent"
                      >
                        {course.name} +
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}

              <div className="hang">
                <span aria-hidden="true" className="hidden lg:block" />
                <div className="grid gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
                  {views.map((view) => (
                    <a
                      key={view.id}
                      href={`#course-${view.id}`}
                      className="group block no-underline"
                    >
                      <Meter
                        percent={view.currentGradePercent}
                        label={view.name}
                        caption={`${view.upcoming.length} outstanding${
                          view.overdueCount > 0
                            ? ` · ${view.overdueCount} overdue`
                            : ""
                        }`}
                      />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="sheet">
            {/* ===================== TARGET ===================== */}
            {/* Not a numbered section — it governs every dossier below, so it
                reads as a setting rather than as content. */}
            <section id="target" className="mt-[var(--section)] scroll-mt-20">
              <Rule />
              <div className="hang mt-5">
                <p className="serial hidden lg:block" aria-hidden="true">
                  02
                </p>
                <div>
                  <div className="mb-6">
                    <p className="rubric mb-2">
                      <span className="lg:hidden">02 · </span>Set a grade target
                    </p>
                    <p className="prose max-w-[56ch] text-[0.95rem] text-ink-soft">
                      Pick the grade you&apos;re aiming for and every class below
                      will show what you need to average on the work that&apos;s
                      left.
                    </p>
                  </div>
                  <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
                    <p className="rubric">Currently aiming for {target}%</p>
                    <span className="docket">
                      {calibration.applied
                        ? `pace calibrated ×${calibration.biasFactor.toFixed(2)} from ${calibration.comparableLogs} logs`
                        : `${calibration.totalLogs} effort logs — ${Math.max(0, 3 - calibration.comparableLogs)} more to calibrate`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {GRADE_TARGETS.map((option) => (
                      <Link
                        key={option.label}
                        href={`/classes?target=${option.percent}`}
                        className="control"
                        data-active={option.percent === target ? "true" : undefined}
                        aria-current={option.percent === target ? "true" : undefined}
                      >
                        {option.label} · {option.percent}%
                      </Link>
                    ))}

                    <form action="/classes" className="flex items-center gap-3">
                      <label htmlFor="custom-target" className="rubric">
                        custom
                      </label>
                      <input
                        id="custom-target"
                        type="number"
                        name="target"
                        min={1}
                        max={150}
                        defaultValue={target}
                        className="field w-16"
                      />
                      <button type="submit" className="control">
                        Set
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </section>

            {/* ===================== DOSSIERS ===================== */}
            <div className="mt-[var(--section)] flex flex-col gap-[var(--section)]">
              {views.map((view, index) => (
                <Dossier
                  key={view.id}
                  view={view}
                  whatIf={whatIfs[index]}
                  index={index}
                  deck={decks.find((entry) => entry.courseId === view.id)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
