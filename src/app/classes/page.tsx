import Link from "next/link";

import { toggleCourseHidden } from "@/app/actions";

import { EffortLogForm } from "@/components/EffortLogForm";
import { CardGenerateButton } from "@/components/review/CardGenerateButton";
import { SyllabusUpload } from "@/components/SyllabusUpload";
import { Docket, DocketRow } from "@/components/press/Docket";
import { Figure } from "@/components/press/Figure";
import { Mark } from "@/components/press/Mark";
import { PageHeader } from "@/components/press/PageHeader";
import { Plate } from "@/components/press/Plate";
import { Rule } from "@/components/press/Rule";
import { SectionHead } from "@/components/press/SectionHead";
import { CourseForm } from "@/components/CourseForm";
import { GradeEditor } from "@/components/GradeEditor";
import { TaskRowActions } from "@/components/TaskRowActions";
import { Trace } from "@/components/press/Trace";
import { getHiddenCourses, getClassViews, type ClassView } from "@/lib/classes";
import { courseStyle } from "@/lib/courses/color";
import { getCalibration } from "@/lib/effort/estimate";
import { getDeckSummaries, type DeckSummary } from "@/lib/flashcards/deck";
import { formatSchoolDay } from "@/lib/digest/day";
import { gradeLabel } from "@/lib/format";
import { formatPoints, gpaFor } from "@/lib/grades/gpa";
import { daysRemaining, type GradingPeriod } from "@/lib/grading-period";
import {
  GRADE_TARGETS,
  calculateWhatIf,
  type WhatIfResult,
} from "@/lib/grades/what-if";
import { STATUS_VAR, levelForGrade } from "@/lib/status";
import { isOwnedTask, taskOriginLabel } from "@/lib/tasks/ownership";

/**
 * The ledger, scoped to one nine weeks.
 *
 * ## Why this was rebuilt
 *
 * The previous version printed a full dossier for every class: a grade, a trace,
 * a what-if, an outstanding list, a flashcard block, an effort form and a
 * syllabus uploader, each with a sentence explaining itself. On the first day of
 * term — no grades posted, five of eight classes with nothing due — that came to
 * 11.6 screens, almost all of it scaffolding announcing its own emptiness:
 * "Not enough grade history yet", "Nothing outstanding", "No cards yet",
 * "Nothing to log yet", four times over. The page was longest precisely when it
 * had least to say.
 *
 * Three rules fix that, and they are the thing to preserve:
 *
 *   1. **A block that has nothing in it does not render.** Not a placeholder,
 *      not a greyed-out stub — absent. Emptiness is carried once, by the class's
 *      own summary line, not restated by every component inside it.
 *   2. **Classes with nothing going on are grouped, not repeated.** Five silent
 *      classes are one short list, each still openable.
 *   3. **Setup is behind a disclosure.** Uploading a syllabus is a once-a-term
 *      act and does not deserve permanent residence between you and your
 *      homework.
 *
 * ## Why a nine weeks
 *
 * A Texas grade is a fact about one marking period and resets when it closes, so
 * the year was never the right window — it just made the page grow until May.
 * `getClassViews` returns the current period alongside the classes, and the page
 * names it. Nothing is hidden by this: work outside the period is counted and
 * reported per class, it simply is not what the page leads with.
 */

export const dynamic = "force-dynamic";

const DEFAULT_TARGET = 87;

const TREND_MARK: Record<string, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
  unknown: "·",
};

function periodRange(period: GradingPeriod): string {
  const format = (date: Date) =>
    date.toLocaleDateString([], { month: "short", day: "numeric" });

  return `${format(period.start)} – ${format(period.end)}`;
}

/**
 * The stat strip for one class.
 *
 * Rendered only when at least one tile would say something. With no grade and no
 * graded work, "needed for 87%" resolves to the target printed back at you and
 * "waiting on a grade" to zero — three tiles restating that nothing has happened
 * yet, which is exactly the noise this page was drowning in.
 */
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

  /*
   * With nothing graded yet, "needed for 87%" is 87% — the target handed back
   * as though it were an answer. It only becomes information once some of the
   * points are spent, so the tile waits for a current standing to exist.
   */
  const solvable = required !== null && result.currentPercent !== null;

  return (
    <div className="flex flex-wrap gap-3">
      {solvable ? (
        <Figure
          label={`Needed for ${result.targetPercent}%`}
          value={required! < 0 ? "locked in" : `${Math.ceil(required!)}%`}
          level={level}
          hint={
            required! > 100 ? "not reachable on the work that's left" : undefined
          }
        />
      ) : null}

      {result.awaitingGrade > 0 ? (
        <Figure
          label="Waiting on a grade"
          value={String(result.awaitingGrade)}
          tally={{ to: result.awaitingGrade }}
          hint="handed in, not marked yet"
        />
      ) : null}

      {result.mode === "weighted" ? (
        <Figure label="Basis" value="weighted" hint="from your syllabus" />
      ) : null}
    </div>
  );
}

/** Whether `WhatIf` would draw anything at all. */
function whatIfHasContent(result: WhatIfResult | null): boolean {
  if (!result) return false;

  return (
    (result.requiredPercent !== null && result.currentPercent !== null) ||
    result.awaitingGrade > 0 ||
    result.mode === "weighted"
  );
}

function CategoryTable({ result }: { result: WhatIfResult }) {
  return (
    <Docket>
      {result.categories.map((category) => (
        <li
          key={category.name}
          /* Wraps rather than squeezing: four columns plus a category name is
             wider than a phone once the gaps are counted, and the name is the
             part that has to stay whole. */
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule/70 py-2.5 last:border-b-0"
        >
          <span className="w-full min-w-0 text-[0.875rem] sm:w-auto sm:flex-1">
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
            {category.percent === null ? "—" : `${category.percent.toFixed(1)}%`}
          </span>
          <span className="docket w-20 text-right opacity-70">
            {Math.round(category.remainingPoints)} left
          </span>
        </li>
      ))}
    </Docket>
  );
}

/** One row of assignments, shared by the outstanding and closed lists. */
function AssignmentRows({ items }: { items: ClassView["upcoming"] }) {
  return (
    <Docket>
      {items.map((assignment) => (
        <DocketRow
          key={assignment.id}
          title={assignment.title}
          dueAt={assignment.dueAt}
          level={assignment.submitted ? "calm" : assignment.level}
          submitted={assignment.submitted}
          assignmentId={assignment.submitted ? undefined : assignment.id}
          difficulty={assignment.difficulty}
          /* Says where a row came from when it wasn't Canvas — a task read off
             a teacher's page is inferred, and the student should be able to see
             that before trusting it. */
          meta={taskOriginLabel(assignment.source) ?? undefined}
          trailing={
            assignment.score !== null && assignment.pointsPossible
              ? `${assignment.score}/${assignment.pointsPossible}`
              : assignment.submitted
                ? "submitted"
                : `~${assignment.estimatedMinutes}m`
          }
          /* The class card is where a completed task can be un-ticked or
             deleted. Without this, marking one done on the front page was a
             one-way trip: it vanished from every list that filters on
             `submitted: false` and there was nowhere to change your mind. */
          action={
            isOwnedTask(assignment.source) ? (
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
  );
}

/**
 * Where the grade actually came from, said plainly.
 *
 * Two systems report a grade for the same class and they disagree: HAC is the
 * district's gradebook and its average is the one on the report card, while
 * Canvas shows whatever that teacher happens to keep there. A number with no
 * attribution cannot answer the question the student is actually asking, which
 * is "is this my real grade?"
 */
const GRADE_SOURCE_LABEL: Record<string, string> = {
  HAC: "from Home Access Center",
  CANVAS: "from Canvas",
  MANUAL: "you set this",
};

/**
 * The class summary: what you're sitting at, and what it's worth.
 *
 * The grade is the reason anyone opens a page called Classes, so it leads — and
 * it is immediately followed by the translation nobody wants to do in their
 * head. See lib/grades/gpa.ts for why the unweighted figure is the one printed
 * large and the weighted one always carries its assumption on its face.
 */
function GradeBlock({ view }: { view: ClassView }) {
  const level = levelForGrade(view.currentGradePercent);
  const gpa = gpaFor(view.currentGradePercent, view.name);

  return (
    <div>
      <p className="rubric">Grade in class</p>

      {view.currentGradePercent !== null && gpa ? (
        <>
          <p
            className="fig fig--xl mt-1"
            style={level === "calm" ? undefined : { color: STATUS_VAR[level] }}
          >
            {gradeLabel(view.currentGradePercent)}
          </p>

          <p className="mt-2 text-[0.95rem]">
            <span className="display display--sm">{gpa.letter}</span>
            <span className="text-ink-soft">
              {" "}
              · {formatPoints(gpa.points)} GPA
            </span>
          </p>

          {gpa.rigor ? (
            <p className="docket mt-1">
              {formatPoints(gpa.weightedPoints)} weighted · {gpa.rigor.label}{" "}
              +{formatPoints(gpa.rigor.bonus)}
            </p>
          ) : null}

          <p className="docket mt-2 opacity-70">
            {view.gradeSource
              ? GRADE_SOURCE_LABEL[view.gradeSource]
              : "source unknown"}
          </p>
        </>
      ) : (
        <>
          <p className="fig fig--xl mt-1 opacity-25">—</p>
          {/*
            Two different absences, and only one of them is actionable. HAC
            having the class but no average is the normal state at the start of
            a term and there is nothing to do about it; HAC never having heard
            of the class means the sync did not match it and the student can fix
            that by typing a number in.
          */}
          <p className="docket mt-2 max-w-[34ch] leading-relaxed">
            {view.fromHac
              ? "HAC hasn't posted an average for this class yet."
              : "No average posted yet."}
          </p>
        </>
      )}

      <div className="mt-3">
        <GradeEditor
          courseId={view.id}
          courseName={view.name}
          percent={view.currentGradePercent}
          fromCanvas={view.fromCanvas}
        />
      </div>
    </div>
  );
}

/**
 * Studying, promoted out of the drawer.
 *
 * Cards and the nightly digest were both buried in "Class setup" alongside the
 * syllabus uploader, which put the two things you do *every day* in the same
 * place as the thing you do once a term. They are the whole reason the digest
 * and review features exist, so each class now says plainly what it has to study
 * and links straight at it.
 */
function StudyLinks({
  view,
  deck,
}: {
  view: ClassView;
  deck: DeckSummary | undefined;
}) {
  const due = deck?.due ?? 0;
  const total = deck?.total ?? 0;
  const uncarded = deck?.uncardedNotes ?? 0;

  return (
    <div className="mt-7 border-t border-rule pt-5">
      <p className="rubric mb-3">Study</p>

      <div className="flex flex-wrap items-center gap-2">
        {due > 0 ? (
          <Link href={`/study/${view.id}`} className="control" data-active="true">
            Review {due} card{due === 1 ? "" : "s"}
          </Link>
        ) : null}

        {uncarded > 0 ? (
          <CardGenerateButton
            courseId={view.id}
            label={`Make cards from ${uncarded} note${uncarded === 1 ? "" : "s"}`}
          />
        ) : null}

        {due === 0 && total > 0 ? (
          <Link href={`/study/${view.id}`} className="control">
            {total} card{total === 1 ? "" : "s"}
          </Link>
        ) : null}

        {/* The primary action here when there is nothing to review and nothing
            to make cards from — with no notes, the digest is the only next step,
            and an unaccented row of controls would not say which one to press.
            One accented thing per region, and this is it. */}
        <Link
          href={
            view.latestNoteDate
              ? `/study?date=${formatSchoolDay(view.latestNoteDate)}&course=${view.id}`
              : `/study?course=${view.id}`
          }
          className="control"
          data-active={due === 0 && uncarded === 0 ? "true" : undefined}
        >
          Tonight&apos;s notes
        </Link>
      </div>

      {/*
        One line, and only when there is genuinely nothing — otherwise the
        controls above already say the state and this would restate it.
      */}
      {total === 0 && uncarded === 0 ? (
        <p className="docket mt-3 max-w-[40ch] leading-relaxed">
          Cards are written from this class&apos;s nightly notes. Build a digest
          first and they can be made from it.
        </p>
      ) : (
        <p className="docket mt-3">
          {total} card{total === 1 ? "" : "s"}
          {due === 0 && deck?.nextDueAt
            ? ` · next on ${deck.nextDueAt.toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}`
            : ""}
          {view.noteCount > 0
            ? ` · ${view.noteCount} note${view.noteCount === 1 ? "" : "s"}`
            : ""}
        </p>
      )}
    </div>
  );
}

/**
 * The once-a-term machinery, folded away.
 *
 * Everything left in here is setup: teaching the estimator your pace, handing
 * the parser a syllabus. Useful, and never the reason you opened the page.
 * Flashcards and the digest used to live here too and no longer do — they are
 * daily work and were invisible behind a summary line.
 */
function ClassSetup({ view }: { view: ClassView }) {
  const loggable = [...view.upcoming, ...view.recent];

  return (
    <details className="disclosure border-t border-rule">
      <summary>Class setup</summary>

      <div className="grid gap-x-10 gap-y-8 pb-2 pt-3 lg:grid-cols-2">
        <div>
          {loggable.length > 0 ? (
            <>
              <p className="rubric mb-3">Log effort</p>
              <EffortLogForm
                assignments={loggable.map((assignment) => ({
                  id: assignment.id,
                  title: assignment.title,
                  estimatedMinutes: assignment.estimatedMinutes,
                }))}
              />
            </>
          ) : (
            <p className="docket">
              Nothing to log — this appears once there is work in this class.
            </p>
          )}
        </div>

        <div>
          <p className="rubric mb-3">Syllabus</p>
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

          <p className="rubric mb-3 mt-8">This class</p>
          {/* Not a delete: the next sync would recreate it. The grade editor
              moved up into the summary, where the grade is. */}
          <form action={toggleCourseHidden}>
            <input type="hidden" name="courseId" value={view.id} />
            <button
              type="submit"
              className="text-[0.75rem] text-ink-soft underline underline-offset-2 hover:text-[color:var(--flare)]"
            >
              Hide this class
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}

/**
 * The head of a class card: which class, how it's doing, what it owes.
 *
 * Shared by the full dossier and by a quiet class, so the two read as the same
 * object in two states rather than as two different components.
 */
function ClassHead({ view }: { view: ClassView }) {
  const gradeLevel = levelForGrade(view.currentGradePercent);

  return (
    <div className="card__head flex-wrap gap-y-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="dot" style={courseStyle(view.name)} aria-hidden="true" />
        <Plate as="h3" className="display display--md plate--fit min-w-0">
          {view.name}
        </Plate>
      </div>

      <div className="flex shrink-0 items-baseline gap-x-5">
        {view.overdueCount > 0 ? (
          <span className="flex items-center gap-1.5">
            <Mark level="urgent" />
            <span className="rubric" style={{ color: STATUS_VAR.urgent }}>
              {view.overdueCount} overdue
            </span>
          </span>
        ) : null}

        {view.upcoming.length > 0 ? (
          <span className="rubric">{view.upcoming.length} due</span>
        ) : null}

        {/* No grade, no figure. An em-dash here was the largest, darkest mark on
            every quiet card — a placeholder shouting that there is nothing to
            say. The standing list above keeps its dash because it is a column
            and a column needs a cell. */}
        {view.currentGradePercent !== null ? (
          <span
            className="fig text-[1.25rem]"
            style={gradeLevel === "calm" ? undefined : { color: STATUS_VAR[gradeLevel] }}
          >
            {gradeLabel(view.currentGradePercent)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** How many assignments a card shows before you have to ask for the rest. */
const PREVIEW_ROWS = 4;

/**
 * The work, in a column of its own.
 *
 * Shows what is next and hides the tail behind a disclosure. Seventeen rows is
 * not a list you read, it is a list you scroll past — but it is also the list
 * that has to be *there*, because "show me everything in this class" is a real
 * question with no other answer in the product. So: the next few always, the
 * rest one click away, closed work with them.
 */
function AssignmentPanel({ view }: { view: ClassView }) {
  const preview = view.upcoming.slice(0, PREVIEW_ROWS);
  const rest = view.upcoming.slice(PREVIEW_ROWS);
  const hidden = rest.length + view.recent.length;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <p className="rubric">Due this nine weeks</p>
        <span className="docket text-[0.6875rem] opacity-70">
          {view.upcoming.length}
        </span>
      </div>

      {view.upcoming.length === 0 ? (
        <p className="docket">Nothing due in this nine weeks.</p>
      ) : (
        <AssignmentRows items={preview} />
      )}

      {hidden > 0 ? (
        <details className="disclosure mt-1">
          <summary>
            {rest.length > 0
              ? `All ${view.upcoming.length} assignments`
              : `${view.recent.length} closed`}
          </summary>

          <div className="pb-2 pt-2">
            {rest.length > 0 ? <AssignmentRows items={rest} /> : null}

            {view.recent.length > 0 ? (
              <>
                <p className="rubric mb-2 mt-5">Closed</p>
                <AssignmentRows items={view.recent} />
              </>
            ) : null}
          </div>
        </details>
      ) : null}

      <Elsewhere view={view} />
    </div>
  );
}

/** One line naming work this page is deliberately not showing. */
function Elsewhere({ view }: { view: ClassView }) {
  const parts = [
    view.overdueEarlier > 0
      ? `${view.overdueEarlier} unfinished from earlier in the year`
      : null,
    view.outstandingLater > 0 ? `${view.outstandingLater} due later` : null,
  ].filter(Boolean);

  if (parts.length === 0) return null;

  return <p className="docket mt-3">{parts.join(" · ")}</p>;
}

function Dossier({
  view,
  whatIf,
  deck,
}: {
  view: ClassView;
  whatIf: WhatIfResult | null;
  deck: DeckSummary | undefined;
}) {
  const trend = view.trend;

  // The trace draws its own "not enough history yet" message. That is the right
  // behaviour for a chart the reader asked for and the wrong one for a chart
  // that appears on eight classes unbidden, so the gate is here.
  const hasTrace = (trend?.points.length ?? 0) >= 2;

  return (
    <article
      id={`course-${view.id}`}
      className="card scroll-mt-24"
      style={{ "--status": STATUS_VAR[view.level] } as React.CSSProperties}
    >
      <ClassHead view={view} />

      {/*
        Summary on the left, work on the right.

        The two halves answer different questions and the reader almost never
        wants both at once: "how am I doing in this class" is a glance, "what do
        I actually have to do" is a list. Stacked, the list buried the summary
        under seventeen rows; side by side, the grade stays on screen while the
        work is scrolled.
      */}
      <div className="card__body grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <GradeBlock view={view} />

          {view.struggles.length > 0 ? (
            <div className="mt-6 flex flex-col gap-3">
              {view.struggles.map((struggle) => (
                <div
                  key={struggle.id}
                  className="flex gap-3"
                  style={
                    { "--status": STATUS_VAR[struggle.level] } as React.CSSProperties
                  }
                >
                  <span className="mt-1.5">
                    <Mark level={struggle.level} />
                  </span>
                  <p className="prose text-[0.9rem]">
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
          ) : null}

          {whatIfHasContent(whatIf) ? (
            <div className="mt-6">
              <WhatIf result={whatIf!} />
            </div>
          ) : null}

          {hasTrace ? (
            <div className="mt-6">
              <p className="rubric mb-2">Grade over time</p>
              <Trace points={trend!.points} level={trend!.level} />
              {trend && trend.changePercent !== null ? (
                <p
                  className="docket mt-2"
                  style={
                    trend.level === "calm"
                      ? undefined
                      : { color: STATUS_VAR[trend.level] }
                  }
                >
                  {TREND_MARK[trend.direction]}{" "}
                  {`${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent.toFixed(1)} pts`}
                  {trend.consecutiveDrops >= 2
                    ? ` · down ${trend.consecutiveDrops} checks`
                    : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {whatIf && whatIf.mode === "weighted" ? (
            <div className="mt-6">
              <p className="rubric mb-2">Categories</p>
              <CategoryTable result={whatIf} />
            </div>
          ) : null}

          <StudyLinks view={view} deck={deck} />
        </div>

        <div className="min-w-0 lg:col-span-7">
          <AssignmentPanel view={view} />
        </div>
      </div>

      <div className="px-[0.875rem]">
        <ClassSetup view={view} />
      </div>
    </article>
  );
}

/**
 * A class with nothing happening: head and setup only.
 *
 * Still a card, still anchorable from the standing list, so jumping to it from
 * above lands somewhere real rather than on a name in a paragraph.
 */
function QuietClass({
  view,
  deck,
}: {
  view: ClassView;
  deck: DeckSummary | undefined;
}) {
  return (
    <article id={`course-${view.id}`} className="card scroll-mt-24">
      <ClassHead view={view} />

      {/* Even a silent class keeps its study links and its grade line. Those are
          the two things that are true whether or not anything is due, and
          burying them behind a disclosure here was what made flashcards feel
          like they did not exist for half the timetable. */}
      <div className="card__body pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="docket">
            {view.currentGradePercent !== null && view.gradeSource
              ? GRADE_SOURCE_LABEL[view.gradeSource]
              : view.fromHac
                ? "HAC hasn't posted an average yet."
                : "No average posted yet."}
          </p>
          <GradeEditor
            courseId={view.id}
            courseName={view.name}
            percent={view.currentGradePercent}
            fromCanvas={view.fromCanvas}
          />
        </div>

        <Elsewhere view={view} />
        <StudyLinks view={view} deck={deck} />
      </div>

      <div className="px-[0.875rem]">
        <ClassSetup view={view} />
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

  const [{ period, classes }, calibration, decks, hidden] = await Promise.all([
    getClassViews(),
    getCalibration(),
    getDeckSummaries(),
    getHiddenCourses(),
  ]);

  const whatIfs = new Map(
    await Promise.all(
      classes.map(
        async (view) =>
          [
            view.id,
            await calculateWhatIf({
              courseId: view.id,
              targetPercent: target,
              window: period,
            }),
          ] as const,
      ),
    ),
  );

  // Classes that need the reader's attention lead; the silent ones are grouped
  // underneath. Within each group, the busiest first — on a page whose job is
  // "which class needs the time", alphabetical order is an arbitrary answer.
  const active = classes
    .filter((view) => !view.quiet)
    .sort(
      (a, b) =>
        b.overdueCount - a.overdueCount ||
        b.upcoming.length - a.upcoming.length ||
        a.name.localeCompare(b.name),
    );
  const quiet = classes.filter((view) => view.quiet);

  const totalOutstanding = classes.reduce(
    (sum, view) => sum + view.upcoming.length,
    0,
  );
  const totalOverdue = classes.reduce((sum, view) => sum + view.overdueCount, 0);
  const left = daysRemaining(period);

  return (
    <main className="flex-1">
      <PageHeader
        eyebrow={`${period.label} · ${periodRange(period)} · ${left} day${left === 1 ? "" : "s"} left`}
        title="Classes"
        purpose="One card per class for the nine weeks you're in: the grade, what's due, and what it needs."
        meta={
          totalOverdue > 0 ? (
            <p className="rubric" style={{ color: STATUS_VAR.urgent }}>
              {totalOverdue} overdue
            </p>
          ) : (
            <p className="rubric">nothing overdue</p>
          )
        }
      />

      {classes.length === 0 ? (
        <section className="sheet mt-[var(--section)]">
          <Rule />
          <p className="prose mt-6 text-ink-soft">
            Nothing synced yet. Run a sync from{" "}
            <Link href="/" data-slip="" className="link">
              the front page
            </Link>
            .
          </p>
          <div className="mt-8">
            <CourseForm />
          </div>
        </section>
      ) : (
        <>
          {/* ===================== THE STANDING ===================== */}
          <section className="band mt-[var(--section)] py-[var(--section)]">
            <div className="sheet">
              <SectionHead
                id="standing"
                rubric="Standing"
                title="All classes"
                description="Every class on the same scale, so you can see which one needs the time."
                aside={
                  <span className="docket">
                    {totalOutstanding} due · {classes.length} classes
                  </span>
                }
              />

              <Docket>
                {classes.map((view) => {
                  const gradeLevel = levelForGrade(view.currentGradePercent);

                  return (
                    <li key={view.id} className="border-b border-rule/70 last:border-b-0">
                      <a
                        href={`#course-${view.id}`}
                        className="flex items-center gap-3 py-2.5 no-underline"
                      >
                        <span
                          className="dot"
                          style={courseStyle(view.name)}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-[0.875rem]">
                          {view.name}
                        </span>

                        {view.overdueCount > 0 ? (
                          <span
                            className="docket shrink-0 text-[0.6875rem]"
                            style={{ color: STATUS_VAR.urgent }}
                          >
                            {view.overdueCount} overdue
                          </span>
                        ) : null}

                        <span className="docket w-16 shrink-0 text-right text-[0.6875rem] opacity-70">
                          {view.upcoming.length > 0
                            ? `${view.upcoming.length} due`
                            : ""}
                        </span>

                        <span
                          className="fig w-16 shrink-0 text-right text-[0.9375rem]"
                          style={
                            view.currentGradePercent === null
                              ? { opacity: 0.35 }
                              : gradeLevel === "calm"
                                ? undefined
                                : { color: STATUS_VAR[gradeLevel] }
                          }
                        >
                          {gradeLabel(view.currentGradePercent)}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </Docket>

              {/* Adding a class and un-hiding one are both rare; they sit under
                  the list rather than above it, where they used to be the first
                  thing on a page about classes you already have. */}
              <details className="disclosure mt-5 border-t border-rule">
                <summary>Add or unhide a class</summary>
                <div className="pb-2 pt-3">
                  <CourseForm />

                  {hidden.length > 0 ? (
                    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
                </div>
              </details>
            </div>
          </section>

          <div className="sheet">
            {/* ===================== TARGET ===================== */}
            {/* A setting, not a section: it governs every card below. */}
            <section id="target" className="mt-[var(--section)] scroll-mt-20">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <p className="rubric">Aiming for {target}%</p>
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
            </section>

            {/* ===================== THE CARDS ===================== */}
            {active.length > 0 ? (
              <div className="mt-[var(--section)] flex flex-col gap-[var(--block)]">
                {active.map((view) => (
                  <Dossier
                    key={view.id}
                    view={view}
                    whatIf={whatIfs.get(view.id) ?? null}
                    deck={decks.find((entry) => entry.courseId === view.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="prose mt-[var(--section)] text-ink-soft">
                Nothing is due in any class this nine weeks.
              </p>
            )}

            {quiet.length > 0 ? (
              <section className="mt-[var(--section)]">
                <SectionHead
                  rubric="Quiet"
                  title="Nothing this nine weeks"
                  size="md"
                  description="Classes with no work and no grade in the current marking period."
                  aside={<span className="docket">{quiet.length} classes</span>}
                />
                <div className="flex flex-col gap-3">
                  {quiet.map((view) => (
                    <QuietClass
                      key={view.id}
                      view={view}
                      deck={decks.find((entry) => entry.courseId === view.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}
