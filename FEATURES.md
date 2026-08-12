# FEATURES.md — Gladiator

## Tier 1 — MVP (build this first)

- **Canvas ingestion**: assignments, due dates, point values, submission status, grades per course, announcements
- **Dashboard home view**: today's due items, this week's grade snapshot, upcoming deadlines
- **Auto calendar sync**: every Canvas due date/test/project becomes a Google Calendar event automatically, without stomping on events the user has manually moved
- **Daily plan generation**: each morning, the LLM produces a prioritized task list from due dates + estimated effort
- **Grade trend view**: simple per-class trend line, nothing fancy yet

## Tier 2 — the intelligence layer

- **Struggles engine**: cross-references due dates, submission status, and grade trend to flag real patterns — a missed-assignment cluster, a grade sliding two checks running, a class going quiet on submissions. Generates a plain-English explanation, not just a red dot.
- **Workload forecast / heat map**: visual of the next two weeks showing which days are about to get brutal, before it's a surprise
- **Syllabus parser**: drop a syllabus PDF in at the start of a semester, the LLM extracts every due date, test date, and grade weighting into the system in one pass
- **Grade "what-if" calculator**: "what do I need on the final for a B+," computed from actual weighted categories, not a guess
- **Weekly retro**: LLM-generated Sunday summary — wins, struggles, what to adjust
- **Effort calibration engine**: after finishing something, log a quick actual-vs-estimated time note; the planner gets better at estimating this specific user's pace, not a generic average
- **Nightly lesson digest**: at the end of the school day, pulls together everything covered in class — new Canvas module content, posted slides/docs, and any textbook pages uploaded — and distills it into short key-point notes per class. Replaces highlighting entirely: the user reads the distilled notes instead of marking up the textbook. Textbook pages go in as a photo (vision-capable model extracts the text) or a saved PDF page range; Canvas content is already directly accessible, no upload needed. Shares its output with the flashcard generator below, so the same key points can become review cards instead of prose.

## Tier 3 — quality of life

- **Auto-flashcards** *(built, ahead of the rest of this tier)*: turns the digest's key points into review cards — one model call per night's notes rather than a second pass over the raw material. Scheduling is SM-2 with four-button grading; rewriting a deck keeps every card's review history, so "regenerate" is safe on a deck you've been reviewing for a month.
- **Drive-linked reference view**: specific files/folders (by link) attached to the assignment they belong to, so opening a task also surfaces the doc for it
- **Cram-mode generator**: given a test in N days, reverse-engineers a study schedule from what Canvas already has for that unit
- **Textbook pace tracker**: given "read pages 40–80 by Friday," auto-splits into daily page targets
- **Energy-aware replanning**: mark a morning as low-energy and the plan reshuffles — lighter cognitive load first, heavy stuff pushed to when sharper
- **Quick-capture inbox**: dump a stray thought/task via text or voice anytime, triage it later instead of losing it
- **"Explain this feedback"**: paste a teacher's written comment/rubric note, the LLM turns it into one concrete next step

## Tier 4 — the "crazy" extras (stretch, high fun-to-effort ratio)

- **Voice hook**: "hey, what's due tomorrow" via the user's existing Ultron voice assistant project
- **Personal Discord bot / SMS digest**: push today's plan somewhere lighter-weight than opening the app
- **Phone home-screen widget**: today's plan + next due date, zero taps
- **Semantic notes search**: embed the user's own notes/assignments, search by meaning instead of exact keyword
- **PWA offline mode**: works with no wifi at school
- **Browser extension**: detects a Canvas assignment page, offers to log an effort estimate or add it to today's plan
- **Long-game tracking**: GPA trajectory toward specific goals, extracurricular/volunteer hour log, scholarship/college deadline tracker
- **Semester-end analytics**: which classes ate the most time versus grade payoff — an effort-ROI view per class

## Visual identity — behavior spec

Full design tokens, typography and layout rules live in `CLAUDE.md`; the motion patterns live in `MOTION.md`. This section is the functional behavior spec for the signature elements referenced there.

> Superseded three times: an ambient status orb with a spacecraft-HUD treatment per page;
> then a printed almanac on warm paper with a misregistered ghost plate; then a workbook
> on cool stock with a chartreuse highlighter. All were scrapped in full. Anything below
> is the ruled-notebook system that replaced them — see CLAUDE.md.

### The school year

Canvas keeps every course a student has ever been enrolled in, and their assignments come with them. In practice: 204 assignments, **56 due before this school year started** — some dated 2021 — and **111 with no due date at all**, all sitting in the same lists as tonight's homework. No amount of sorting fixes that; last year's work simply is not this year's problem.

Every list, the two-week forecast, the timetable and the planner are bounded by the school year. Defaults come from [Frisco ISD's published 2026-27 calendar](https://www.friscoisd.org/o/flex/article/3034519) — first day **12 August 2026**, last day **14 May 2027**, taken from the district's own student calendar PDF — and both ends are editable on the Routine page, because a district calendar is a fact about one district and one year.

Undated assignments are excluded too, deliberately. An assignment with no due date cannot be late, cannot be planned and cannot be scheduled: every list in this product keys off a due date. Mostly they are not work at all.

The effect on this student's data: **37 assignments in scope, 167 out of it.**

### The weekly routine

Everything else in this product answers "what is due". The routine answers **"when are you actually free"**, and until it existed the planner had to guess: free time was a single clock range from an env var — 16:00 to 21:30, the same for everybody, every day of the week. A schedule built on that is one you cannot follow, and a schedule you cannot follow is one you stop opening.

A student enters when they wake and sleep, school hours, practice, shifts, and anything they want protected. Per weekday, because Tuesday is not Saturday. The page is laid out as the week itself — seven cards you read across, each showing its blocks and, the number that actually matters, how much of the day is left.

- **Sleep bounds the day**; everything else is carved out of it. `startMinutes` is bedtime and `endMinutes` is wake time, always, with no inference from the numbers.
- **Days are checkboxes**, so "practice Tuesday and Thursday" is one entry, not two.
- **Overlaps merge.** Adding "school 08:00–15:20" and then "band 15:00–16:30" is how people describe their week; unmerged they would produce a negative-length gap and the day would silently lose time.
- **Times are minutes past midnight, not timestamps.** A routine is a clock fact — "practice ends at six" is true every Tuesday, independent of date. Storing it as a timestamp on an arbitrary day is how a planner ends up telling someone to start work at 3am after the clocks change.
- **Google Calendar is subtracted on top.** The routine is what happens every week; the calendar is what happens *this* week. Both are busy.

An empty routine offers to start from a typical school week rather than presenting thirty-five blank fields, which is where people give up.

The fallback window is kept for anyone who has not set one up, so nothing regresses on first run.

> The first version decided whether a sleep block bounded the day by asking if it
> crossed midnight. `22:30–07:00` worked; an ordinary Saturday lie-in entered as
> `01:00–10:00` did not cross midnight, so it was classified as a *nap*, marked
> busy, and the day fell back to the 16:00 default — losing the entire morning
> and afternoon of the one day with the most free time in it. Caught by testing
> the invariants against six shaped days, not by reading the code.

### Home Access Center

HAC has **no API**. Signing in means doing what a browser does — GET the login page, carry its anti-forgery token and cookies into a POST, follow the session — and it needs the student's **real district password**, not a revocable token. `ARCHITECTURE.md` flagged this as the one integration to build last and only after the tradeoff was explicitly re-confirmed. It was.

What that means, stated plainly because a student should be able to decide with it in front of them:

- It is not a scoped token. There is no button anywhere that turns one copy of it off.
- It is stored **encrypted** (AES-256-GCM, key derived from `CREDENTIAL_SECRET`). That is not a vault: the server must be able to sign in as you, so it must be able to decrypt, so the key is on the same machine. What it defends against is the realistic failure — a database dump or a stray backup putting a working school password in plain sight.
- **Without `CREDENTIAL_SECRET` set, connecting is refused** rather than falling back to plaintext, and refused *before* the password is transmitted anywhere.
- Disconnecting deletes it.

Two behaviours matter more here than elsewhere:

- **A failed HAC login returns HTTP 200 with the login form again.** Without detecting that, a wrong password is indistinguishable from a student with no classes, and the app would report "0 courses found". The response is checked for the login form before anything is parsed.
- **A rejected password is never retried.** School portals lock accounts, and a background job re-presenting a wrong password would lock the student out of the system they actually need.

Grades match existing classes by name, with the district course code stripped, so "1234 - AP Calculus AB" from HAC lines up with "AP Calculus AB" from Canvas. A class only HAC knows about is created with a null `canvasId`, so a Canvas sync leaves it alone. A class with no posted percent is reported, not written as a zero.

**The parser is the part most likely to need adjusting.** HAC is not one product — it is eSchoolPlus rendered by whatever version and theme a district runs. Parsing is deliberately isolated in `lib/hac/parse.ts`, with no network or storage in it, so it can be corrected against real saved HTML without touching login or credentials.

### Connecting Canvas

Credentials come from the `Setting` table first, then the matching env var. Env-only was fine for whoever deployed this and useless for the student using it: connecting Canvas meant editing a file and restarting a server.

Pressing **Sync Canvas** with nothing connected offers the connect form instead of the old error, which was an instruction to go and edit a server config. The token is checked against the real Canvas (`/api/v1/users/self`) *before* it is stored, so a wrong address, an expired token and a school that has disabled personal access tokens each produce their own message — rather than one indistinguishable failure later, during a sync.

**The token is write-only from the browser's side.** The status endpoint returns whether a credential exists, the host, and the token's last four characters. The token itself is never returned by any method, including to the page that just saved it. Whatever a student pastes as the address is normalised, so `canvas.school.edu`, `https://canvas.school.edu/` and the URL of the page they happened to be on all work.

Secrets sit in the database in plaintext. That is not a regression — the env vars they replace were plaintext too, and this app has no user table by design — but the database is now credential-bearing.

### Connecting Google Calendar

Pressing **Connect Google Calendar** runs the OAuth consent flow and stores the resulting refresh token in the `Setting` table. The callback used to print that token on a page and ask you to paste it into `.env` and restart the server — a developer handoff standing in the middle of a student's setup. It is now stored directly and never rendered: a secret echoed into HTML lands in the browser's history, its cache, and any screenshot of the moment it worked.

Two kinds of credential, and only one belongs to the student:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` identify **the app**. Same for everyone on a deployment, and creating them means owning a Google Cloud project. Environment only. When they are absent the UI says Google Calendar is unavailable rather than offering a button that returns a 400 — a student cannot fix that, so pretending otherwise wastes their time.
- `GOOGLE_REFRESH_TOKEN` is **the account**, produced by consenting. Database first, env as fallback.

**Notifications come from the calendar, not from this app.** Once connected, every due date is pushed as a real calendar event, and the calendar the student already has open on their phone delivers the reminder — on the lock screen, without this app running. Building a notification system here would be rebuilding something they already have.

Events are created with reminders at **12 hours and 2 hours before**, rather than Google's default ten minutes: a ten-minute warning on a deadline is an obituary, and the useful alert is the one that arrives while there is still time to act. Reminders are only ever set **on create** — updates use PATCH without that field, so a student who changes or silences an event's reminders keeps their change through every future sync.

### Difficulty

Canvas knows an assignment's points and its title. It has no idea whether *you* understand the topic, and that is usually the difference between a 20-minute problem set and a 90-minute one. A 1–5 rating is the only signal in the system for it, and it comes from the one person who actually knows.

Set it by **double-clicking a row**, or by clicking the small rating badge on it. Double-click alone would be invisible and unreachable from a keyboard; the badge is how you discover the feature exists.

The rating multiplies the effort estimate — gently and asymmetrically (`brutal` ≈ ×1.9, `trivial` ≈ ×0.55), because this is a judgement made in one second and a single mis-tap should not wreck an evening. **3 is exactly ×1.0**, so rating something "normal" changes nothing; unrated is not the same as "average". It deliberately does **not** apply on top of time you have actually logged against that assignment — the reason it took 90 minutes is already in the 90 minutes.

Because estimation feeds the workload forecast and the daily schedule, one tap changes how much of an evening the planner sets aside. It works on Canvas assignments as well as your own tasks: it is your opinion of the work, not a property of the row, so a sync cannot overwrite it.

### The daily schedule

The morning plan is a **timed schedule**, not an ordered list, and it is built in two stages that are deliberately kept apart:

1. **The model decides *what*.** Which work to do today, in what order, how long to give each piece, and one sentence on why. Judgement calls, on the strong model. It is told explicitly not to stop at today's deadlines: once today's due work is covered it keeps going with work due later in the week, because a day with nothing due is a day to get ahead rather than a day off, and a big item due in five days should be started now rather than becoming a crisis the night before.
2. **`lib/planner/schedule.ts` decides *when*.** Plain, testable code lays those tasks onto the clock: inside the hours actually free (the study window minus anything on your calendar), splitting long work into balanced sessions, inserting breaks, and reserving dinner before any work is placed.

**The model is never asked for clock times.** Laying out a day is constraint satisfaction — no overlaps, inside the free windows, never past the end of the evening, never two hours of unbroken work — and language models are unreliable at exactly that. The failure mode is quiet: a schedule that reads plausibly and has you eating dinner twice.

What the layout pass guarantees, for any non-overlapping set of free windows:

- every block sits entirely inside one free window;
- no block starts before the previous one ends;
- every start, end and duration is a multiple of five minutes;
- there is never more than `PLAN_FOCUS_MINUTES` of consecutive work without a break;
- no single task takes more than half the usable day when others are competing for it;
- nothing is scheduled in the past;
- dinner is placed if the day has room, and moved to the start of the window if the evening opens after the preferred time;
- work that does not fit is **dropped, not squeezed** — an unachievable plan is worse than a short one.

These are enforced by ordinary code and checked against fabricated days — a normal evening, a mid-evening commitment, an hour of free time, no free time at all, one enormous task, and odd-numbered estimates.

Three of them exist because the first version got them wrong:

- **Round times.** It produced "7:15–8:03" and 48-minute sessions. Nobody follows that. Snapping to five minutes costs a few minutes of dead time a day and buys a schedule you can read off a clock.
- **Fair share.** A single 115-minute lab report swallowed an entire evening and dropped four other pieces of work, one due the next morning. Partial progress on the things that matter beats finishing one and abandoning the rest — and the estimate that produced the 115 was a guess.
- **Nothing in the past.** The window is a clock range, so regenerating at 7pm handed the layout three and a half hours that had already happened. Only applies to today; a plan for tomorrow gets its whole window.

The timetable shows the same schedule under **today** — and only today. "What's due" is a fact about any day; "here is your evening, hour by hour" only exists for the day a plan was written for, and showing yesterday's blocks against a Thursday would be actively misleading.

### Right now

The schedule answers "what does today look like". A panel at the top of the front page answers the question a student actually opens the app to ask — *what am I supposed to be doing this minute* — with the current block, how long is left in it, and what follows. The live row is highlighted in the schedule itself.

"Now" is computed **in the browser**, never on the server: a deployment renders in UTC and the student is somewhere else, so a server-rendered "current block" would be wrong by hours and disagree with the browser at hydration. The panel renders a stable placeholder until it mounts. The schedule underneath is fully server-rendered and never depends on it — with JavaScript off you lose the highlight and the panel, and keep a working schedule you can still tick work off in.

Sessions are balanced rather than greedy: 60 minutes becomes 30 + 30, not 50 + 10. Filling each run to the brim leaves stubs, and a 45-minute task that came out as "40 minutes, 20 minute break, 5 minutes" is a worse plan than not splitting at all. Session labels are numbered from what was actually placed, so they can never read "(3 of 2)".

Breaks and dinner are rows in the same list as the work, not furniture layered over it — the point of the schedule is that 7:15 work, 8:03 break and 6:30 dinner are one sequence you read top to bottom. Only work blocks can be ticked off.

Cadence, window and dinner time are configured in `.env` (`PLAN_*`).

### The pressure chart

The front page's centerpiece, and the only place the product takes the scroll away from you. It answers the one question a calendar cannot: **how much of the time you actually have is already spoken for.**

- Each of the next fourteen days hangs as a column from the top rule; its length is the work due that day.
- Across each column is a tick at the hours that day genuinely has free, after existing commitments — its **waterline**.
- The part of a column that punches past its own waterline is the part that does not fit, and it prints in `flare`. This needs no legend.
- Driven by `StruggleFlag` severity + the workload forecast, so it requires the forecast and struggles engine to exist first.
- Scrubbed and pinned: a read head sweeps left to right, columns strike down as it reaches them, and a margin readout re-prints to whichever day the head is over.

### Ink language

The status ladder is `calm → warming → urgent`, and **calm is plain ink** — a page where nothing is wrong prints in one colour. Signal inks appear only where attention is genuinely due, which is what stops them becoming decoration. Nothing conveys meaning by colour alone: marks are filled, hollow or struck through, and every bar carries length as well as ink.

### Navigation

A broadsheet nameplate: the title left, the five sections as a numbered index right, one heavy rule under it, the current section the only inked entry. Clicking one runs a **sheet slip** — a sheet of stock covers the outgoing page and slips away from the incoming one — rather than a plain fade.

Required fallbacks, not optional: the nameplate stacks on a phone; the pinned chart unpins below `48rem`; `prefers-reduced-motion` gets a complete branch that prints every final state immediately. The whole product must be readable with no JavaScript at all — on a school Chromebook, on a slow connection, on a failed bundle.

### Per-page treatments

Each page is composed differently on purpose — five pages sharing one section skeleton is what makes a product feel templated.

- **Front page (the broadsheet)**: dateline, one verdict set enormous with a per-character strike, the standing figures on the same screen, then the pressure chart full-bleed as the lead illustration. Everything below is a printed schedule.
- **Classes (the ledger)**: a standing table where every class can be compared at once, then one dossier per class — grade hung in the margin as the largest thing on the spread, grade trend plotted as a trace on a ruled field, outstanding work as a docket.
- **Calendar (the timetable)**: no chart repeat. A ruled week table — three ruled staves of seven days, each cell scaled against *its own* capacity so the waterline ticks line up into a rule down the grid and weekday rhythm becomes visible on its own.
- **Nightly digest (the reader)**: the instrument furniture dropped entirely. One measure, sticky margin notes naming the class, key points as a numbered docket. No effect gets between the reader and the words at 11pm.
- **Review (the sitting)**: the one screen you are meant to be *inside* rather than scanning, and the only one with a compact header instead of the full masthead — question, answer and the four grading buttons share a single view, keyboard-first, with each button showing the interval it would set.
- **Weekly retro (the debrief)**: evidence first — the week as a register of marks, struck through where something was missed — then the prose underneath. You should see the week before anything tells you what it meant.

### Cohesion rule

Reuse the same primitives everywhere instead of inventing an effect per page: the ink ladder mapped consistently, the rule and the hanging margin as the only structure, the figure as the hero, and the title rule as the one ornament. If a stranger saw any one page with the title covered, they should still recognize it as the same document as the others.
