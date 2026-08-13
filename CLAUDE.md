# CLAUDE.md — Gladiator Design System

Personal single-user school command center. Read this file before writing any UI code — it's the design system, and it's what keeps every screen feeling like one document instead of five separately-designed pages.

## Concept

**This is an application.** That sentence is the design system; everything below is a consequence of it.

Three previous versions of this file were editorial print systems — a broadsheet almanac, a marked-up workbook, a ruled notebook. Each was internally coherent and each produced the same failure: something that looked like a well-designed magazine article *about* a school tool rather than a school tool. The palettes were never the problem. Rules-and-a-hanging-margin, a figure as hero, one headline per screen and a 9rem gap between sections are magazine decisions, and they cost the reader the only thing they came for — seeing the week.

So the shape is now the shape every tool people actually like converges on: **a persistent sidebar, content grouped onto surfaces, and enough density that a page answers your question without scrolling.**

The register is **alert and orderly**, which is different from loud. Alertness comes from a bright page, high-contrast navy text and one confident blue doing all of the pointing. Order comes from grouping. Nothing here glows, gradients, bounces or neons.

**The accent is selective.** It appears where the answer to "where am I / what do I press" lives: the current nav item, the rule under the page title, the primary control, hover and focus, and selected text. It is never decoration.

**There is no dark mode, deliberately.** This is a tool used to wake up to a workload and decide what to do about it, and a bright page is part of that job. It is also load-bearing for the palette: every ink below is built and measured for dark type on white paper, and a negative plate would mean re-tuning all of them. `color-scheme: light` is set explicitly so a dark-OS visitor gets the same page, form controls and scrollbars included.

> Four dead systems live in this repo's history, and the pattern in them is the useful
> part: **a ruled notebook** (blue rules, hanging margin, one headline per screen), a
> **marked-up workbook** (cool stock, acid-chartreuse highlighter), a **printed almanac**
> (oatmeal paper, Instrument Serif, `moss`/`ochre`/`vermilion`, a misregistered ghost
> plate), and a **spacecraft HUD** (status orb, `core-cyan`, `voidglass`). The first three
> were re-skins of each other: each time the answer looked like "wrong colours" and each
> time it was "wrong skeleton". If this design ever feels off again, check the skeleton
> before the palette.
>
> A reference anywhere to an orb, a ghost plate, misregistration, a marker, a highlighter,
> a hanging margin, a through-line, a masthead, `--ghost`, `--marker`, `--sweep`, `--vel`,
> `moss`, `ochre` or `vermilion` is stale documentation, not a component to match.

## The page

One printing, light only.

| Token | Value | Role |
|---|---|---|
| `--paper` | `#FCFCFA` | The stock. Notebook white, the barest warmth off `#FFF` so a full screen doesn't glare. |
| `--paper-deep` | `#F1F3F7` | Second stock for full-bleed bands. Faintly *blue* rather than darker, so a band changes the pacing without dimming the page. |
| `--ink` | `#16233A` | Primary ink. Navy-black — the colour of a good pen. `#000` reads as a PDF. |
| `--ink-soft` | `#5A6B85` | Secondary ink — captions, provenance, quiet copy. |
| `--ink-faint` | `#66748B` | Small figures and mark outlines. Still has to be *read* — holds 4.6:1. |
| `--rule` | `#C9D2E0` | Hairlines, tinted to the ink so the page's lines and its writing come from one pen. |
| `--accent` | `#2B57C4` | **Direction, not status.** The ruled line. |
| `--accent-ink` | `#FFFFFF` | Label colour on top of a filled accent. |
| `--jade` | `#1D7A4D` | Affirmative — closed, submitted, improving. |
| `--amber` | `#A15A00` | Warming — building up, due soon. |
| `--flare` | `#C42B2B` | Urgent — overdue, flagged, overloaded. |
| `--course-1…8` | see below | **Which class.** Never text — bars and dots only. |

**Ink means something.** The status ladder is `calm → warming → urgent`, and **calm is plain navy — no signal ink at all**. A page where nothing is wrong is one colour. The signal inks only appear where attention is genuinely due, which is what stops amber and flare becoming decoration. Jade is the affirmative case and is asked for by name (`AFFIRM_VAR`), never derived from a level.

**The accent is not on that ladder and never will be.** It says where you are and what to press. Giving it a status meaning too would make both meanings useless.

**Two colour systems, two slots, never crossed.** This is the rule that lets a page carry course colours *and* a status ladder without either becoming noise:

| System | Answers | Appears as | Never appears as |
|---|---|---|---|
| Course colour | *which class* | a bar or dot at a row's left edge | text |
| Status ink | *how urgent* | text, or a `Mark` | a left-edge bar |

They can never be confused because they never occupy the same position. That is also why the course palette contains **no red, no amber and no green** — a Biology row that happened to print green must never read as a submitted one.

Course colours are assigned by position in the sorted class list and emitted once by the root layout as `--course-<slug>` custom properties. See `src/lib/courses/color.ts`, which documents why this is a map and not `hash(name) % 8` — with eight colours and six classes, hashing collided about 78% of the time and three classes rendered identically.

Every mark, meter, column and row resolves its ink through `src/lib/status.ts`. Never hard-code a hex at a call site. Reaching for a fifth colour is a signal to stop and map it back to one of these states.

Every ink in that table clears 4.5:1 against **both** stocks (worst case `--paper-deep`). Re-measure with a contrast script before changing one — amber is the fragile one, since a yellow bright enough to feel like a warning is usually too light to read.

## Typography

- **Display — Archivo, a touch wide.** Loaded as the variable cut with the `wdth` axis exposed, set at `wdth 106` / weight 560 for headings and `wdth 112` / weight 620 for hero figures. **The width axis is the design element**, but held near the middle: run out to 125 and heavy, it reads as sports lettering, and this is a notebook. (Do not name a static `weight` in `next/font`; that silently drops the axis and every heading falls back to normal width.)
- **Body and UI — Hanken Grotesk.** Humanist, open, genuinely comfortable at 14px and at 11pm. All paragraphs, all form labels, all rubrics.
- **Docket — DM Mono.** Serials, timestamps, provenance, model names. **Hard rule: paragraphs never live in the mono.** The digest and the retro are why.

All three load through `next/font`, so they're self-hosted and preloaded with no layout shift.

Emphasis inside display type **takes the accent** (`.display em`). Not italic — a grotesk italic at this size reads as a mistake — and not a highlight, which read as a marker pen and made every emphasised phrase compete with the navigation.

**The type scale is UI type, not article type.** Body is 15px, labels 11–13px, and `display--xl` — the page title — is under 2rem. It was 6.5rem two versions ago and 4.75rem one version ago; both spent the entire first screen saying the word "Classes". A heading in a tool should be unmistakably a heading and then get out of the way.

Figures are always tabular (`.fig`), so columns of numbers align and a counting figure never jitters its own width.

## Layout

**Group before you decorate.** Related things sit on one surface with a hairline border. Whitespace alone does not group — it only separates, which is exactly why three versions of this design read as one undifferentiated column of text.

- `.app` — the shell: a `15rem` sidebar and a content column. Below `64rem` the sidebar becomes a horizontally scrolling strip at the top.
- `.sheet` — the content measure (`78rem`) with the gutter applied. Every section sits in one.
- `.card` — a surface: `1px` border, `0.5rem` radius, a shadow you have to look for. Optional `.card__head` / `.card__body`.
- `.tile` — a metric tile. Four to six above the fold, one number each, nothing competing.
- `.docket-list > li` — rows inside a list card. The horizontal inset lives on the **container's children**, not on `DocketRow`, because half the lists in the product are hand-written `<li>`s and they had no padding of their own.
- `.chip` / `.dot` — the course colour bar and dot. `--course` is set from `courseStyle(name)`.
- `.band` — a full-bleed section on the second stock, for a footer or a section that should sit back.

**Density is the measure of this design.** `--gutter`, `--section` and `--block` are roughly a third of what the editorial system used. If a page feels sparse, the fix is more of the week on screen, not bigger type.

`.hang` and `.serial` still exist as no-ops, because all six pages render them. `.hang` is a plain block; `.serial` is hidden. **`.serial`'s hide rule lives *outside* `@layer components` on purpose** — inside it, `lg:block` in the markup won and bare numerals came back as body text.

`--gutter`, `--section` and `--block` are the only spacing values a page should reach for. If something feels tight, use them — never shave them locally.

**One rule that fails silently if you break it:**

1. **Component classes live in `@layer components` in `globals.css`.** Unlayered CSS outranks every Tailwind utility, so a `.rubric` defined at the top level silently beats `normal-case`, `.docket` beats `text-[0.625rem]`, and `.field` beats `w-24` — no error, the override just does nothing. Anything new that markup will want to override belongs inside that layer.

**The six pages still read differently on purpose** — a product where every page is the same stack of cards feels templated:

- **Front page** — verdict, a metric strip, the workload chart, then everything due.
- **Classes** — every class on one comparable scale, then a card per class, scoped to the nine weeks you are in. Two rules hold this page together and it fell apart once without them: **a block with nothing in it does not render** (no "no cards yet", no empty trace, no what-if that hands the target back as the answer), and **classes with nothing happening are grouped, not repeated**. Setup — syllabus, effort, cards, hide — lives behind a `.disclosure`, because a once-a-term action should not sit between the reader and their homework. Printed flat with placeholders, this page was 11.6 screens on a day when it had almost nothing to say.
- **Timetable** — three weeks of seven days, so weekday rhythm is visible on its own.
- **Digest** — one measure of prose, nothing between the reader and the words.
- **Retro** — the week as evidence first, prose underneath.
- **Review** — one card at a time, keyboard first.
- **Routine** — the week as seven cards, not a settings form. It is the only setup surface in the product, and setup screens that look like forms feel like chores.

**The primitives carry the system, not the pages.** `PageHeader`, `SectionHead`, `Docket`/`DocketRow`, `Figure` and `Meter` are where the surfaces, density and course colours live. That is deliberate and worth preserving: the entire move from an editorial layout to this one was made by rewriting those five components plus the shell — the six page files were not touched. Put new visual decisions in a primitive, not in a page.

## Motion

> The principles here are the rules. **`MOTION.md` is the implementation** — the physical
> metaphor, the two tempos, and the named patterns every animated element is built from.
> Read it before adding any motion. An effect that isn't one of those patterns (or a
> deliberate extension of one) is how a coherent system turns back into a pile of tricks.

Physical metaphor: **a hand working on paper.** A rule snapped down against a straightedge, a figure written, a line ruled under it. Quick to start, decisive to stop. Two tempos, one easing family, **zero overshoot** — a straightedge does not spring back.

Motion here is deliberately restrained: this is a page you scan for a due date, and anything that visibly moves while you are trying to read it is working against you.

- Pages never import GSAP. They mark up intent (`data-draw`, `data-strike`, `data-advance`, `data-press`, `data-mark`) and `src/components/press/Press.tsx` decides how it moves. A new section is animated correctly by default rather than by remembering to.
- **Every hidden pre-animation state is gated behind `html.js`**, set by an inline script in the document head. If scripting fails, nothing is hidden and the page renders as static type — with the title rule already at full width. Content that only exists once JavaScript agrees to reveal it is the single most common way a page like this ends up blank — this is not optional.
- Reveals are driven by IntersectionObserver, not scroll position. The pinned chart adds over a screen of spacer after the layout has already measured, and anything holding a stale scroll offset would stay hidden forever.
- Every effect has a `prefers-reduced-motion` path that shows the final state immediately.
- No JS smooth-scroll library. This is a tool you scroll fast to find a due date on, and inertia fights that.

## Text

**Every sentence on a screen has to earn its place, and most did not.** The page header explained what the page was for, every section carried a small-caps label restating its own title plus a sentence describing itself plus sometimes a line explaining how to use it, every schedule row repeated its task's reason, every break said "stand up, water", and the footer re-listed all six sections the sidebar was already showing. All of it read fine once and was noise forever after.

The rules:

- **A label that restates the heading next to it is deleted**, not shrunk.
- **Explanations of what a section is** are deleted. If a section cannot be understood from its title and its content, fix the content.
- **A reason belongs to a thing, not to each of its rows.** A task split across three sessions explains itself once.
- **Never explain the self-evident.** "Break" needs no subtitle.
- **Never say the same thing in two places.** The chart's legend covers the chart; the sidebar covers navigation.
- Prefer deleting a sentence to making it smaller. Small grey text is still text.

`PageHeader` still accepts `purpose` and `contents`, and `SectionHead` still accepts `rubric`, `description` and `hint` — accepted and deliberately not rendered, because all six pages pass them and accepting-and-ignoring is far cheaper than editing every call site. Re-render one only when the bar above is genuinely met.

## Negative constraints

- No pure black, and no pure white except `--paper-lift` — always the tuned `--paper` / `--ink`.
- No glow, no bloom, no pulsing, no neon. Urgency is carried by *which ink is used*, not by brightness.
- No cards, no border-radius, no drop shadows, no gradient meshes, no glassmorphism.
- No decorative use of a signal ink. If it isn't warming or urgent, it prints in plain graphite.
- No decorative use of the accent either, and never more than one accented thing per region. It answers "where am I / what am I about to press" and nothing else. If you are reaching for it to make a section livelier, that section needs better type or better spacing, not more blue.
- No dark mode, and no neon anything. Both were tried; see the concept note above.
- No paragraphs in the mono, and no low-contrast body copy — the two text-heavy pages are read tired.
- Don't reuse this palette or the notebook metaphor on client work — this is a personal-brand system, kept separate from the Daylight / harbor-tideglass-brass system used for client projects.
