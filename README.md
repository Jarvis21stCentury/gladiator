# Gladiator

Personal single-user school command center.

- `CLAUDE.md` — design system (color tokens, typography, motion rules). Read before writing UI.
- `ARCHITECTURE.md` — stack, data sources, data model.
- `FEATURES.md` — feature tiers and the behavior spec for the pressure chart / ink language.
- `MOTION.md` — the motion language and the named patterns the UI is built from.
  Read it before adding any animation.

## Status

**Tier 1 and Tier 2 of `FEATURES.md` are built, and so is the visual identity.** All five
pages are real: the front page (masthead verdict, standing figures, the pinned pressure
chart, the manifest), Classes (standing table, grade traces, dossiers, what-if calculator,
effort logging, syllabus intake), Calendar (the three-week timetable and its day sheet),
the nightly digest, the weekly retro, and flashcard review.

**Tier 3 has started**: auto-flashcards are built. Cards are written from
`LessonNote.keyPoints` — the digest schema calls those "the shared surface the
flashcard generator will read from", and this is the thing that cashes it in, so
a card costs a rephrasing call rather than a second extraction over the same
textbook text. Scheduling is SM-2 (`src/lib/flashcards/schedule.ts`, pure and
free of Prisma so it can be reasoned about on its own). A card's identity is the
key point it came from, so regenerating a deck rewrites the questions and keeps
the review history.

Not built, and deliberately: **Tier 3 and Tier 4**. Drive-linked references, cram mode,
auto-flashcards, textbook pace tracking, energy-aware replanning, quick-capture, "explain
this feedback", the voice hook, Discord/SMS, the widget, semantic search, PWA offline,
the browser extension, long-game tracking and semester analytics are all still open.
`HAC` remains where `ARCHITECTURE.md` left it — last, and only after an explicit
re-confirmation of the tradeoff.

### What runs without an API key

Every feature that the front page's most load-bearing elements depend on is deterministic:
struggle *detection*, the workload forecast, grade trends, the what-if calculator and the
effort calibration are all arithmetic over the database. The LLM only writes prose — the
daily-plan narrative, the digest, the retro, and the plain-English rewrite of a struggle
flag. With no `LLM_API_KEY` set, flags still appear with a rules-written sentence and the
front page's verdict is still correct; `explainedBy` on each flag records which wrote the
text.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Prisma 7 + Postgres (Neon) · Vercel

There is no auth layer by design — no login screen, no user table. The app runs as a
single identity and every credential lives in environment variables.

## Local setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and the Canvas vars
npx prisma migrate dev    # applies migrations
npm run dev
```

`.env` currently points at a local Postgres database (`school_os_dev`) rather than Neon,
so development works offline. Swap in the Neon pooled connection string when you want to
work against the deployed data.

### Demo data

Every screen is a view onto a database that starts empty, and an empty Gladiator looks
identical whether it is working perfectly or not working at all. To see it working
without a Canvas token:

```bash
npm run db:seed                                      # six classes, a mid-semester week
curl -X POST 'http://localhost:3000/api/struggles/detect?explain=0'
```

The seed writes a plausible situation — one class with a missed-assignment cluster and a
sliding grade, one overloaded Wednesday, weighted syllabus categories on another class,
and enough effort logs to switch the calibration engine on — so all five rules in the
struggles engine have something real to find. Everything it writes is marked: courses use
negative Canvas ids and generated rows record `provider: "seed"`, so demo data can never
be mistaken for something a model actually wrote. Re-running replaces it.

## Routes

| Path | Page |
|---|---|
| `/` | Front page |
| `/classes` | Classes — the ledger |
| `/calendar` | Calendar — the timetable |
| `/digest` | Nightly Digest |
| `/review` | Review — flashcard decks |
| `/review/[courseId]` | Review — one subject's sitting |
| `/retro` | Weekly Retro |

Navigation is the nameplate index at the top of every page — the five sections numbered,
the current one the only inked entry (`src/components/press/nav.ts` is the single list all
of it renders from). Clicking one runs a sheet slip over the route change. The nameplate
stacks on a phone, and the transition is skipped entirely under `prefers-reduced-motion`;
the links are plain `next/link` anchors either way, so navigation works with the
transition layer absent.

## Database

Prisma 7 requires a driver adapter: the CLI reads `DATABASE_URL` through `prisma.config.ts`,
and the app builds a `PrismaPg` adapter in `src/lib/prisma.ts`. The generated client lands in
`src/generated/prisma` (gitignored, regenerated on every build).

```bash
npm run db:migrate   # create + apply a migration
npm run db:push      # push schema without a migration (early scaffolding only)
npm run db:studio    # browse data
npm run db:seed      # replace the demo data
```

Models: `Course`, `Assignment`, `GradeSnapshot`, `CalendarBlock`, `DailyPlan` /
`PlanTask`, `EffortLog`, `LessonNote`, `StruggleFlag`, `WeeklyRetro`, plus
`Announcement`, `SyncRun` and `DigestSource` for ingestion, and `GradeCategory` /
`SyllabusImport` for the syllabus parser. `DriveFileRef` and `CollegeItem` from
`ARCHITECTURE.md` arrive with the Tier 3/4 features that need them.

`Assignment.canvasId` is nullable and `Assignment.source` distinguishes `CANVAS` from
`SYLLABUS` rows: a test date printed on a syllabus has no Canvas object behind it.
Postgres allows many NULLs in a unique index, so the Canvas upsert-on-id path is
untouched.

## Canvas ingestion

Set `CANVAS_BASE_URL` and `CANVAS_TOKEN` (Canvas → Account → Settings → Approved
Integrations → New Access Token), then trigger a sync:

```bash
curl -X POST http://localhost:3000/api/sync
```

or press **Sync Canvas** on the front page. The job pulls courses with current grades,
assignments with due date / points / submission status, and announcements, then upserts
on Canvas IDs so re-running is safe. It also writes one `GradeSnapshot` per course per
day, which is what makes grade trends possible later.

Vercel Cron will POST the same endpoint. Set `SYNC_SECRET` in production to require
`Authorization: Bearer <secret>` — that is endpoint protection, not user auth.

### iCal fallback

If `CANVAS_TOKEN` is missing or Canvas rejects it (401/403), the sync automatically
falls back to the private Calendar Feed URL in `CANVAS_ICAL_URL`. That path has **due
dates only** — no grades, points, or submission status. The dashboard shows a banner
and renders grades as "unavailable" whenever the last run used it, and the fallback only
writes titles and due dates so it can never overwrite richer API data.

## Google Calendar sync

Every assignment with a due date becomes a 30-minute event ending at the deadline.

### One-time setup

1. Google Cloud Console → new project, on your **personal** Google account (not the
   school Workspace one). Enable the Google Calendar API.
2. OAuth consent screen → **External**, publishing status **Testing**, and add your own
   address as the sole test user. No verification is needed at this scale.
3. Credentials → OAuth client ID → **Web application**. Add the redirect URI, exactly
   matching `GOOGLE_REDIRECT_URI` (`http://localhost:3000/api/google/callback` locally,
   and the deployed URL in production).
4. Put the client ID/secret in `.env`, start the app, visit `/api/google/auth`, consent,
   and paste the returned `GOOGLE_REFRESH_TOKEN` into `.env` and Vercel.

Only `calendar.events` is requested — the app cannot read your calendar list, settings,
or anything else on the account.

> Testing-mode refresh tokens expire after 7 days. If the sync starts failing with an
> auth error, re-run `/api/google/auth`. Publishing the app (still with one user) stops
> the expiry.

### How manual edits are protected

The sync only ever touches events it created, proven two ways: a stored `googleEventId`
*and* a private `schoolOsManaged` marker on the event itself. `CalendarBlock.start`,
`end` and `title` hold the last values written, so any difference is the user's doing.

| Situation | What happens |
|---|---|
| Event untouched, Canvas due date changed | Event is updated |
| Event untouched, nothing changed | No API write at all |
| User moved or renamed the event | `userModified` set; **never touched again** |
| User deleted the event | `deletedInGoogle` set; **never recreated** |
| Marker missing (not ours) | Treated as user-owned, left alone |
| Due date removed in Canvas | Event deleted, but only if the user never edited it |

Skipped events are counted and surfaced on the dashboard rather than hidden.

## Daily plan

Each morning a job gathers unsubmitted work due in the next 10 days, estimates effort
for each item, works out how much time actually exists today, and asks the LLM for a
prioritised task list plus a short summary. It lands as a `DailyPlan` with `PlanTask`
rows and renders at the top of the dashboard.

It runs in the morning cron slot (`/api/cron/morning`) right after Canvas ingestion, so
it plans from data pulled seconds earlier. Run it alone with
`curl -X POST localhost:3000/api/cron/daily-plan`.

**Effort estimates** come from the best source available, and the prompt says which:

1. Logged `EffortLog` time on that exact assignment.
2. Extrapolated from logged minutes-per-point in the same class.
3. A heuristic on the title and point value — the fallback until anything is logged.

**Availability** is the window in `PLAN_WINDOW_START`/`PLAN_WINDOW_END` (default
16:00–21:30 local) minus real commitments on the calendar. `ASSIGNMENT`-type
`CalendarBlock`s are excluded: those are the 30-minute deadline markers this app writes,
not commitments, and counting them would consume the very time being planned.

Tasks referencing an assignment id that wasn't in the input are dropped rather than
inserted, so one hallucinated id can't fail the whole plan.

### The LLM layer

**Every vendor SDK call in this app lives in `src/lib/llm.ts`.** Callers pass a Zod
schema to `generateJson()` and get typed, validated data back — they never touch an
OpenAI or Anthropic type. Switching providers is one env var:

```bash
LLM_PROVIDER="openai"     # or "anthropic"
LLM_API_KEY="..."
```

Per ARCHITECTURE.md, `quality: "strong"` is used where writing quality matters (the
daily plan) and `"fast"` for routine structured work. Model ids per tier are
env-overridable via `LLM_MODEL_FAST` / `LLM_MODEL_STRONG`.

Output is validated twice — by the provider's structured-output mode and again by Zod —
so a malformed response fails loudly before anything is written to the database.

## Nightly lesson digest

Everything covered in a day, per class, distilled into short key points at `/digest`.
Per FEATURES.md the notes are meant to *replace* re-reading the source material, so each
key point is written to stand alone — that's also what lets the flashcard generator reuse
them later.

**Canvas content needs no upload.** Module items and announcements are pulled
automatically. Newness is tracked by remembering which module-item ids have been seen
rather than trusting timestamps, because Canvas doesn't reliably expose an `updated_at`
on module items. The first time a course is scanned, everything already in Canvas is
recorded as a **baseline** and excluded — otherwise day one would produce one enormous
digest of the whole semester.

**Textbook pages go in two ways**, both from the form on the page:

| Input | How it's read |
|---|---|
| Photo (JPEG/PNG/GIF/WebP) | Vision model transcribes it |
| PDF + page range (`40-52`) | Text layer read directly — no OCR, no model call |

A page range is required for PDFs so the whole book isn't ingested. Scanned PDFs have no
text layer; the error says so and points you at the photo route. **Uploaded files are
never stored** — the text is extracted and the file discarded, which is the whole premise
of reading the notes instead of the pages.

The distiller runs per class, so one class failing doesn't cost the others, and it skips
any class whose note is already written and has no new material. Adding an upload after
the fact makes that class regenerate.

```bash
curl -X POST localhost:3000/api/digest/generate           # ingest + distil today
curl -X POST "localhost:3000/api/digest/generate?force=1" # rewrite existing notes
```

> Dates are normalised to a "school day" (midnight UTC) exactly once, at the request
> edge. `schoolDay()` is **not** idempotent — re-applying it to its own output shifts the
> day backwards in any timezone west of UTC, which silently hides that day's uploads.
> Functions downstream take an already-normalised day.

## The intelligence layer

### Struggles engine

Detection is entirely deterministic (`src/lib/struggles/detect.ts`). Five rules, each
over data already in the database:

| Rule | Fires when |
|---|---|
| `MISSED_CLUSTER` | ≥2 assignments in one class passed their due date unsubmitted in 14 days |
| `GRADE_SLIDE` | A grade moved down on ≥2 consecutive snapshots |
| `SUBMISSION_SILENCE` | A class with ≥3 items due in 21 days has **none** submitted, while other classes are being handed in normally |
| `WORKLOAD_SPIKE` | A day inside a week has ≥1.25× more work than time |
| `OVERDUE_PILEUP` | ≥3 items overdue across all classes |

Each rule emits a stable `signature` for the *condition*, not the occurrence, so a repeat
run updates one row instead of stacking duplicates — and a condition that stops being
detected auto-resolves without the user dismissing anything. The model's only job is
rewriting `description` into plain English from the evidence, and it is skipped unless a
flag is new or its evidence changed.

The front page's verdict reads the result: the headline and its ink come from the worst
live severity plus near-term workload density (`src/lib/system-state.ts`), and the same
level inks the through-line rail on every page.

```bash
curl -X POST localhost:3000/api/struggles/detect            # detect + explain
curl -X POST "localhost:3000/api/struggles/detect?explain=0" # detect only, free
```

### Workload forecast

Fourteen days on the front page's pressure chart, twenty-one on the calendar timetable,
both from `getWorkloadForecast()`. The unit is **minutes, not assignment count** — four reading
checks and one research paper are five items either way, and only minutes tell you which
day is the problem. Capacity is a default study window minus real calendar commitments;
`ASSIGNMENT`-type blocks are excluded because those are the deadline markers this app
writes, not commitments.

### Grade trends and what-if

Trends read `GradeSnapshot`, one row per course per day. With fewer than two points the
UI says "no trace yet" rather than drawing a flat line and implying a stability nobody
measured. The trace's vertical window is the data's own range, floored at 4 points — a
full 0–100 axis renders every real movement as a flat line.

The what-if calculator has two modes and **the UI always says which**: `weighted` when
the syllabus parser supplied category weights, `flat` otherwise. Presenting a flat-points
estimate as though it came from the syllabus is the one way the feature can actively
mislead. Both modes go through the same linear solver.

### Syllabus parser

Upload a PDF (text layer) or a photo (vision model) per class. It writes `GradeCategory`
weights and `Assignment` rows with `source: SYLLABUS`. **Canvas stays authoritative** —
where a syllabus date collides with an assignment Canvas already has, the Canvas row
wins and only the category is attached. The file is never stored.

### Effort calibration

`EffortLog` rows drive `src/lib/effort/estimate.ts`, which the daily planner and the
workload forecast both read — a heat map built on a different estimate than the plan
would contradict the plan on screen. Precedence: time logged on this exact assignment →
minutes-per-point logged in this class → the title/points heuristic scaled by a personal
bias factor. The bias factor is the mean of per-log ratios rather than total-over-total,
so one enormous assignment can't define it, and it only applies after three comparable
logs.

### Weekly retro

Sunday's debrief, written on the strong model from counted facts and stored alongside
those counts, so the page shows the numbers next to the prose. The week replay at the top
runs first and the paragraph second — the evidence, then the interpretation.

```bash
curl -X POST localhost:3000/api/retro/generate                 # this week
curl -X POST "localhost:3000/api/retro/generate?week=2026-07-20"
```

## The visual system

`CLAUDE.md` holds the tokens and the hard rules. `MOTION.md` holds the motion language and
the named patterns. This is where both live in code.

- `src/lib/status.ts` — the **one** function deciding what level anything is at. Every
  mark, meter, column and docket row resolves ink through it. The cohesion rule only holds
  if there is a single source for it. Note that `calm` is *plain ink*, not a colour: a page
  where nothing is wrong prints in one colour, so the signal inks stay meaningful.
- `src/components/press/` — the primitives. `Plate` (the two-impression display type),
  `Rule`, `Mark`, `Figure`, `Tally`, `Meter`, `Trace`, `Docket`/`DocketRow`, `SectionHead`,
  `Verdict`, `PressureChart`, `Masthead`, `Colophon`, `Throughline`, `Slip`, and `Press`
  itself — the single controller for every generic motion pattern.
- `src/app/globals.css` — plates, measure, motion DNA, the type scale, and every pattern's
  CSS.

**The composition is a printed broadsheet, not a stack of cards.** Structure is carried by
hairline rules and one hanging margin; there are no cards, no radius, no shadows. Each page
is composed differently on purpose — the front page is a masthead over a full-bleed chart,
Classes is a standing table plus one dossier per class, Calendar is a ruled weather table,
and the two reading pages drop the instrument furniture entirely for a 64ch measure with
margin notes.

### Motion, and what it costs

GSAP + ScrollTrigger drive the motion, and `split-type` splits the one kinetic masthead.
Everything else is server-rendered. Pages never import GSAP: they mark up intent
(`data-draw`, `data-strike`, `data-advance`, `data-press`) and `Press.tsx` owns how it
moves, which is what stops five pages drifting into five motion languages.

**No smooth-scroll library, deliberately.** Lenis is the usual backbone at this tier, and
it is the wrong call for a tool whose premise is opening in two seconds and surviving a
school Chromebook. This is a page you scroll fast to find a due date on; inertia fights
that. Native scroll is snappier and cannot fail.

**One pinned scene, and only one.** The pressure chart pins for `+=130%` because watching
three weeks assemble against their waterlines is the product's whole argument. Pinning a
second thing would spend the same budget on something that has not earned it — and pinning
is a real tax, since every visit pays the forced scroll whether it wants the scene or not.
It unpins below `48rem` and under reduced motion.

**No WebGL.** `FEATURES.md` requires the signature element to degrade gracefully on a
school Chromebook, and the honest way to meet that is not to ship a WebGL context in the
first place: no shader compilation, no context to fail to acquire. The chart is DOM and
CSS transforms; the grade trace is SVG, so it inherits ink from the plate for free.

### Failure modes, handled

- **No JavaScript → the page is completely readable.** Every hidden initial state is gated
  behind `html.js`, which an inline script in the document head sets before first paint. If
  that never runs, nothing is ever hidden. Verified by rendering all five pages with
  scripting disabled, not by inspection.
- **Reveals cannot go stale.** They run on IntersectionObserver, not scroll offsets. The
  patterns are registered in the layout, *before* the route's scenes mount — and the pinned
  chart adds over a screen of spacer when it does. Anything holding a measured scroll
  position pointed at the wrong place and left the entire lower half of the front page
  invisible, which is exactly what happened the first time.
- **The bottom of the document.** An inset observer margin can never be satisfied by an
  element sitting in the last few pixels of the page — there is no scroll left to give it.
  `Press` flushes anything still pending once the page is scrolled as far as it goes.
- **Nothing escapes the viewport.** The chart's read head finishes flush with the last day,
  which put its own width past the right edge and gave the whole page a horizontal
  scrollbar until the track was clipped.
- **Reduced motion** gets a complete branch in `Press.tsx`: every pattern resolves to its
  final state immediately, the pin and scrub do not exist, and the ghost plates are not
  rendered. The same page, printed rather than pressed.

## Scheduled runs

**This is set up to run on the Vercel Hobby plan**, which allows at most 2 cron jobs and
fires each only once per day. `vercel.json` uses exactly two:

| Schedule (UTC) | Path | What it does |
|---|---|---|
| `15 11 * * *` | `/api/cron/morning` | Canvas ingestion, then builds today's plan from it |
| `0 22 * * *` | `/api/cron/evening` | Canvas ingestion, Google Calendar push, struggle detection, the retro on Sundays, then the nightly digest |

Struggle detection runs in the evening slot *before* the digest and ahead of its time
budget: it feeds the front page's verdict, it is mostly database arithmetic, and its one
model call is
skipped unless a flag actually changed. The weekly retro is written only when that slot
fires on a Sunday, so it describes a finished week rather than being rewritten nightly.

The Google Calendar push sits in the evening slot on purpose. It is the slowest step —
one API call per assignment — and stacking it in front of the LLM call risks blowing the
60-second Hobby function ceiling, which would cost the daily plan.

The digest runs last in that slot and under a **time budget** (35s), because it is the
one step whose cost isn't a fixed number of calls — it's one model call per class. Any
class it doesn't reach is picked up when the digest page is opened, the same gap-filling
pattern the dashboard uses.

Set `CRON_SECRET` on the Vercel project and Vercel attaches it as
`Authorization: Bearer <secret>` automatically; both cron endpoints reject
unauthenticated requests whenever it is set.

### Staying fresh between cron runs

Twice a day is not enough for "what's due today" to be trustworthy, so **opening the
dashboard is the third trigger**. On load it checks how old the data is and, past 30
minutes, calls `/api/sync/auto` to pull Canvas and push the calendar, then re-renders.
For a tool meant to open in two seconds, the moment you look at it is the right time to
refresh.

That endpoint is deliberately unauthenticated — the browser has no secret to send, and
there is no login in this app by design. What keeps it safe is a server-side throttle:
if a sync started within `AUTO_SYNC_MIN_INTERVAL_MINUTES` (default 10), it returns
`skipped` without touching Canvas or Google, so it cannot be used to burn API rate limit.
A run already in flight is skipped the same way.

That endpoint re-runs struggle detection with `explain: false` after the sync — otherwise
the verdict would be describing the previous pull. The rewrite stays the evening cron's job;
the deterministic sentence is already correct in the meantime.

### Running jobs by hand

```bash
curl -X POST localhost:3000/api/cron/morning                # sync + daily plan
curl -X POST localhost:3000/api/cron/evening                # sync + calendar + flags + digest
curl -X POST localhost:3000/api/cron/sync                   # sync + calendar
curl -X POST "localhost:3000/api/cron/sync?only=calendar"   # calendar only
curl -X POST localhost:3000/api/cron/daily-plan             # plan only
curl -X POST localhost:3000/api/digest/generate             # digest only
curl -X POST localhost:3000/api/struggles/detect            # flags only
curl -X POST localhost:3000/api/retro/generate              # this week's retro
curl -X POST localhost:3000/api/sync/auto                   # throttled refresh
```

### On Vercel Pro

Pro lifts both limits, so you can go back to frequent polling — replace the two entries
with something like `0,30 11-23 * * *` on `/api/cron/sync`, an overnight `0 3 * * *`, and
`/api/cron/daily-plan` on its own morning schedule. The routes already exist; only
`vercel.json` changes.

## Deploy

```bash
npx vercel login
npx vercel link
npx vercel env add DATABASE_URL production   # and preview / development
npx vercel --prod
```

Environment variables needed in production: `DATABASE_URL`, `CANVAS_BASE_URL`,
`CANVAS_TOKEN` (or `CANVAS_ICAL_URL`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `CRON_SECRET`.

`npm run build` runs `prisma generate` first, so Vercel builds pick up the client without
extra configuration.
