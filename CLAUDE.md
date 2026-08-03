# CLAUDE.md — Gladiator Design System

Personal single-user school command center. Read this file before writing any UI code — it's the design system, and it's what keeps every screen feeling like one printed document instead of five separately-designed pages.

## Concept

**A printed almanac of the semester.** Not a dashboard, not a HUD — a two-ink broadsheet.

Everything this product knows is time and pressure: due dates, minutes of work, minutes available, the shape of the next three weeks, a week that has already happened. A timetable is what that data has always wanted to be. So the whole system is built from warm uncoated paper, one structural ink, a small set of signal inks used only where attention is genuinely due, and structure carried by typographic rules and a hanging margin rather than by boxes.

The signature is **plate registration**: display type prints as two impressions, the ink plate and a ghost of the signal plate slightly out of register behind it. They converge as type arrives and drift apart again with scroll velocity. It is the one thing the product should be remembered by, and every other decision extends its logic — printed, physical, precise, never glowing.

> This replaced a spacecraft-bridge / reactor-HUD system (an ambient status orb, orbital
> nav, radar sweeps, oscilloscopes, glow-as-urgency, on `#0A0E14` voidglass). Nothing of it
> survives. If you find a reference to an orb, a status light, `core-cyan`, `voidglass` or
> `steel` anywhere, it is stale documentation, not a component you should be matching.

## Plates

The design is printed twice — a light plate and its negative — and the OS picks. Both are tuned; neither is an afterthought. The negative exists because the nightly digest and the weekly retro get read at 11pm, and it is in-metaphor rather than a bolted-on dark mode.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#F2EDE3` | `#12100D` | The stock. Warm and uncoated — a white page reads as a screenshot, not a print. |
| `--paper-deep` | `#E8E1D3` | `#1A1712` | Second stock, for full-bleed bands that change the pacing. |
| `--ink` | `#15120E` | `#F0EBE1` | Primary ink. Warm near-black; `#000` reads as a PDF. |
| `--ink-soft` | `#6B6458` | `#948C7E` | Secondary ink — captions, provenance, quiet copy. |
| `--rule` | `#CBC2B0` | `#342F27` | Hairlines. The entire structural vocabulary. |
| `--moss` | `#3C6A53` | `#7CB193` | Affirmative — closed, submitted, improving. |
| `--ochre` | `#A86E18` | `#DDA246` | Warming — building up, due soon. |
| `--vermilion` | `#C62F14` | `#EF6A4C` | Urgent — overdue, flagged, overloaded. |

**Ink means something.** The status ladder is `calm → warming → urgent`, and **calm is plain ink — no second plate at all**. A page where nothing is wrong prints in one colour. The signal inks only appear where attention is genuinely due, which is what stops amber and vermilion from becoming decoration. Moss is the affirmative case and is asked for by name (`AFFIRM_VAR`), never derived from a level.

Every mark, meter, column and row resolves its ink through `src/lib/status.ts`. Never hard-code a hex at a call site. Reaching for a fourth signal colour is a signal to stop and map it back to one of these three states.

## Typography

- **Display — Instrument Serif.** Very high stroke contrast, editorial, and it only gets better the larger it is set, which suits an almanac where the figure is the content. Its italic is a design element, never a substitute for bold.
- **Body and UI — Familjen Grotesk.** Quiet, warm, comfortable at 11pm. All paragraphs, all form labels, all rubrics.
- **Docket — Spline Sans Mono.** Serials, timestamps, provenance, model names. **Hard rule: paragraphs never live in the mono.** The digest and the retro are why.

All three load through `next/font`, so they're self-hosted and preloaded with no layout shift.

Figures are always tabular (`.fig`), so columns of numbers align and a counting figure never jitters its own width.

## Layout

**The rule is the structure.** Pages are built from hairlines and a hanging margin. No cards, no border-radius, no shadows, no fill that isn't carrying meaning.

- `.sheet` — the page measure (`84rem`) with the gutter applied. Every section sits in one.
- `.hang` — the hanging margin: a `5.5rem` rail column carrying serials and rubrics, then the content column. **Everything on a page hangs off one left edge.** Content that isn't inside a `.hang` will not line up with content that is, and that misalignment is the most visible way this system breaks.
- `.band` — a full-bleed section on the second stock, used to change pacing between dense and sparse passages, never for decoration.

**The figure is the hero.** This is an almanac: the number gets the space, set huge and tabular, and the prose explains it underneath.

`--gutter`, `--section` and `--block` are the only spacing values a page should reach for. If something feels tight, use them — never shave them locally.

**Two rules that fail silently if you break them:**

1. **`.hang` takes exactly two children** — the rail and the content. It's a two-column grid, so a third child wraps onto the next row *into the 5.5rem rail column* and comes out crushed. Put everything after the rail inside one content wrapper.
2. **Component classes live in `@layer components` in `globals.css`.** Unlayered CSS outranks every Tailwind utility, so a `.rubric` defined at the top level silently beats `normal-case`, `.docket` beats `text-[0.625rem]`, and `.field` beats `w-24` — no error, the override just does nothing. Anything new that markup will want to override belongs inside that layer.

**Each page is composed differently on purpose**, because five pages sharing one section skeleton is what makes a product feel templated:

- **Front page** — a broadsheet: dateline, one verdict set enormous, standing figures, then the pressure chart full-bleed as the lead illustration.
- **Classes** — a report: a standing table where every class can be compared, then one dossier per class with its grade hung in the margin as the largest thing on the spread.
- **Timetable** — an almanac weather table: three ruled staves of seven days, so weekday rhythm is visible on its own.
- **Digest** — the instrument furniture dropped entirely. One measure, margin notes, nothing between the reader and the words.
- **Retro** — evidence first as a full-width week register, prose underneath. You should see the week before anything tells you what it meant.

## Motion

> The principles here are the rules. **`MOTION.md` is the implementation** — the physical
> metaphor, the two tempos, and the named patterns every animated element is built from.
> Read it before adding any motion. An effect that isn't one of those patterns (or a
> deliberate extension of one) is how a coherent system turns back into a pile of tricks.

Physical metaphor: **a printing press.** Type strikes and stops dead; it does not bounce back off the paper. Two tempos, one easing family, zero overshoot.

- Pages never import GSAP. They mark up intent (`data-draw`, `data-strike`, `data-advance`, `data-press`) and `src/components/press/Press.tsx` decides how it moves. A new section is animated correctly by default rather than by remembering to.
- **Every hidden pre-animation state is gated behind `html.js`**, set by an inline script in the document head. If scripting fails, nothing is hidden and the page renders as static type. Content that only exists once JavaScript agrees to reveal it is the single most common way a page like this ends up blank — this is not optional.
- Reveals are driven by IntersectionObserver, not scroll position. The pinned chart adds over a screen of spacer after the layout has already measured, and anything holding a stale scroll offset would stay hidden forever.
- Every effect has a `prefers-reduced-motion` path that shows the final state immediately — the same page, printed rather than pressed.
- No JS smooth-scroll library. This is a tool you scroll fast to find a due date on, and inertia fights that.

## Negative constraints

- No pure black or pure white — always the tuned `--paper` / `--ink` for the current plate.
- No glow, no bloom, no pulsing. Urgency is carried by *which ink is used*, not by brightness.
- No cards, no border-radius, no drop shadows, no gradient meshes, no glassmorphism.
- No decorative use of a signal ink. If it isn't warming or urgent, it prints in plain ink.
- No paragraphs in the mono, and no low-contrast body copy — the two text-heavy pages are read tired.
- Don't reuse this palette or the press metaphor on client work — this is a personal-brand system, kept separate from the Daylight / harbor-tideglass-brass system used for client projects.
