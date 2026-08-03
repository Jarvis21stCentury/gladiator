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

> Superseded: this used to specify an ambient status orb, orbital navigation and a
> spacecraft-HUD treatment per page. That system was scrapped in full. Anything below is
> the printed-almanac system that replaced it.

### The pressure chart

The front page's centerpiece, and the only place the product takes the scroll away from you. It answers the one question a calendar cannot: **how much of the time you actually have is already spoken for.**

- Each of the next fourteen days hangs as a column from the top rule; its length is the work due that day.
- Across each column is a tick at the hours that day genuinely has free, after existing commitments — its **waterline**.
- The part of a column that punches past its own waterline is the part that does not fit, and it prints in `vermilion`. This needs no legend.
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
- **Calendar (the timetable)**: no chart repeat. An almanac weather table — three ruled staves of seven days, each cell scaled against *its own* capacity so the waterline ticks line up into a rule down the grid and weekday rhythm becomes visible on its own.
- **Nightly digest (the reader)**: the instrument furniture dropped entirely. One measure, sticky margin notes naming the class, key points as a numbered docket. No effect gets between the reader and the words at 11pm.
- **Review (the sitting)**: the one screen you are meant to be *inside* rather than scanning, and the only one with a compact header instead of the full masthead — question, answer and the four grading buttons share a single view, keyboard-first, with each button showing the interval it would set.
- **Weekly retro (the debrief)**: evidence first — the week as a register of marks, struck through where something was missed — then the prose underneath. You should see the week before anything tells you what it meant.

### Cohesion rule

Reuse the same primitives everywhere instead of inventing an effect per page: the ink ladder mapped consistently, the rule and the hanging margin as the only structure, the figure as the hero, and plate registration as the one ornament. If a stranger saw any one page with the title covered, they should still recognize it as the same document as the others.
