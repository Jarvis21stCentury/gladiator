# MOTION.md — the press

The implementation of CLAUDE.md's motion principles. Read this before adding any animated element. Every moving thing in the product is one of the named patterns below, or a deliberate extension of one.

## The metaphor

**A printing press.** Type strikes the paper and stops dead. Ink registers. Rules draw across the sheet. A page turns.

Nothing in this product floats, glows, pulses, bounces or eases back. A press that overshoots its stop is a press that has printed the line twice.

## The DNA

One easing family, two tempos, **zero overshoot**.

| Token | Value | Used for |
|---|---|---|
| `--strike` | `cubic-bezier(0.16, 1, 0.3, 1)` | Type, figures, marks — hard arrival, dead stop. |
| `--draw` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Rules extending, meters filling, traces plotting. |
| `--t-micro` | `200ms` | Hover, focus, state swaps. |
| `--t-strike` | `460ms` | The strike tempo. Type and figures. |
| `--t-draw` | `880ms` | The draw tempo. Structure. |

Scrubbed scenes use `ease: "none"` — they are driven by the scroll, and adding a curve on top of the user's own hand is what makes scrubbing feel broken.

In GSAP these read as `expo.out` (strike) and `power2/3.out` (draw). Never `back`, `elastic` or `bounce`.

## Architecture

Pages **never import GSAP**. They mark up intent with data attributes; `src/components/press/Press.tsx` owns how any of it moves.

```
data-draw      a rule                → Rule Draw
data-strike    a line of type        → Press Strike
data-advance   a docket row          → Docket Advance
data-press     a figure or block     → Impression Settle
data-meter     a measured bar        → Meter Fill
.plate__ghost  a second impression   → Plate Registration + Misregistration Drift
```

Two rules make this safe:

1. **Every hidden initial state is scoped to `html.js`**, which an inline script in the document head sets before first paint. No script, nothing hidden — the page is complete, readable static type. This is the difference between a designed page and a blank one.
2. **Reveals use IntersectionObserver, not scroll offsets.** The patterns are registered in the layout, before the route's own scenes mount, and the pinned pressure chart adds over a screen of spacer when it does. Anything holding a measured scroll position would point at the wrong place and never fire. An observer holds no measurement. There is also an explicit flush at the bottom of the document, because an inset root margin can never be satisfied by an element sitting in the last few pixels of the page.

## The patterns

### Plate Registration — the signature
· **Trigger:** entrance · **Choreography:** display type prints twice — the ink plate, and a ghost of the signal plate offset by `0.9rem` behind it. The ghost converges into exact register as the type lands. · **Path:** `--off: 0.9rem → 0`, `expo.out`, 1.1s · **Why:** the product's whole job is getting things aligned, and the brand is print. It is also the only ornament in the system that carries no data, which is why it gets to be the memorable one.

Used via `<Plate>`. The ghost is `aria-hidden` and `user-select: none`, so screen readers and copy-paste only ever see one copy.

### Misregistration Drift — the flow layer
· **Trigger:** scroll velocity (continuous) · **Choreography:** one shared velocity value, lerped and decaying to zero at rest, pulls **every** ghost plate on the page out of register at the same moment. · **Path:** `translate(vel * -9px)` + `rotate(vel * -0.35deg)`, lerp `0.12` · **Why:** this is the connective tissue. It is what makes five sections read as one organism responding to you, rather than a playlist of separate effects — and it costs one CSS custom property write per frame no matter how much is on screen.

### Press Strike
· **Trigger:** enters view · **Choreography:** type rises into place and stops dead. · **Path:** `translateY(0.4em → 0)` + opacity, `expo.out`, 0.62s, 70ms stagger · **Why:** type arriving on a press bed.

> This used to mask the line with `overflow: hidden` and slide it up from behind its own
> rule, which looked better and clipped every heading's right edge for the whole time it
> animated — plus permanently on any heading whose mask release didn't run, and on the
> ghost plate every time it drifted. Text that gets sliced is a worse failure than a
> plainer entrance is a loss. Nothing in this pattern can clip anything now.

### Card Reveal
· **Trigger:** the answer is asked for · **Path:** a local `@keyframes reveal` — opacity and `0.35rem`, 220ms · **Why:** the flashcard answer is created by a client component *after* the observer layer has been wired, so it cannot use `data-press` and has to animate itself. Fast on purpose: this is the thing you were waiting for.

### Kinetic Masthead
· **Trigger:** load · **Choreography:** the one verdict line per page splits to characters and strikes individually with a slight lean, while the ghost converges behind them. · **Path:** `yPercent: 115 → 0`, `skewY: 3 → 0`, 16ms per character · **Why:** spending the kinetic budget on exactly one line keeps it an event. Doing it to every heading makes it wallpaper. Lives in `Verdict.tsx`; the ghost is split identically, because a split face against an unsplit ghost loses its kerning pairs and the second plate reads as dirt rather than as registration.

### Rule Draw
· **Trigger:** enters view · **Path:** `scaleX(0 → 1)` from the left, `power2.out`, 0.88s, 60ms stagger · **Why:** structure arrives before content. Rules sit above the type they introduce, so a section is already framed by the time anything strikes into it — that handoff is what stops sections reading as a stack of unrelated blocks.

### Docket Advance
· **Trigger:** enters view · **Path:** `clip-path: inset(0 100% 0 0) → inset(0)`, `power3.out`, 0.66s, 45ms stagger · **Why:** rows are revealed *along their own rule*, in reading direction. Faster to scan than a stack of independent fades, and physically what a printed line is.

### Impression Settle
· **Trigger:** enters view · **Path:** `y: 0.6rem → 0`, `scale: 1.012 → 1`, opacity in, `expo.out`, 0.7s · **Why:** paper being pressed. The default for figures and blocks that aren't type or rules.

### Tally
· **Trigger:** enters view, once · **Path:** count to value on a quartic ease-out; duration scales with magnitude (380ms–1.1s) · **Why:** an almanac's figures should read as a reading being taken. Tabular figures mean the element never changes width mid-count.

### Meter Fill / Trace Draw
· **Trigger:** enters view · **Path:** `scaleX(0 → 1)` / `stroke-dashoffset → 0`, draw tempo · **Why:** a measurement being laid down. The trace is a rule that happens to know something.

### Waterline Flood — the signature scene
· **Trigger:** scrubbed, pinned (`+=130%`, `anticipatePin: 1`) · **Choreography:** one scrubbed value sweeps a read head left to right; day columns strike down from the top rule as it reaches them, the overload segment floods vermilion a beat behind its own column, and the margin readout re-prints to whichever day the head is over. · **Why:** the one thing this product knows that a calendar does not is how much of the time you have is already spoken for — so it is the biggest thing on the site and the only place the scroll is taken away from you. Four things driven by one source is what makes it read as a single instrument.

Pins below the nameplate by measuring it, not by a hard-coded offset.

### Sheet Slip — transitions
· **Trigger:** click on any `data-slip` anchor · **Path:** `yPercent: 100 → 0`, route changes underneath, `→ -100`, `power4.inOut`, 320ms each half · **Why:** covers the seam. Without it a navigation is a flash followed by a page whose entrances have already half-played. Delegated from the document, so any `data-slip` link anywhere gets it. Modified clicks, new tabs and external links are left alone.

### Through-Line Rail
· **Trigger:** scroll progress (continuous) · **Choreography:** a hairline in the gutter of every page, filling with page progress, inked with the system's current level. · **Why:** the single most effective "one document" device. Whatever page you are on, the same rail runs down the margin at the same colour the front page was.

### Ink Pressure — micro-interactions
· **Trigger:** hover / focus · **Path:** controls flood ink up from the baseline (`scaleY(0 → 1)`, origin bottom); links thicken their own underline rule; colophon entries extend a rule to full width · **Why:** pressure, not a colour swap. Nothing in this system changes colour alone on hover.

## Accessibility

Non-negotiable, and built alongside each effect rather than after:

- `prefers-reduced-motion: reduce` gets a complete branch in `Press.tsx` that sets every final state immediately, skips the pin and scrub entirely, and hides the ghost plates. The same page, printed rather than pressed.
- Real, selectable text stays in the DOM through every split and duplicate.
- **Anything split to characters needs an explicit `aria-label`.** The accessible name is computed from the element's contents, and per-character spans get joined with spaces — without the label the masthead is announced `"C h e m i s t r y — H o n o r s"`, letter by letter. The label carries the sentence; the split glyphs are `aria-hidden` once the split succeeds, and only then.
- The ghost plate is `aria-hidden` and `user-select: none`, so the duplicated impression never reaches the accessibility tree or the clipboard.
- The pinned scene releases cleanly and never traps the scroll; it is unpinned below `48rem`.
- Nothing conveys meaning by colour alone — marks are filled vs hollow vs struck through, and every bar carries length as well as ink.

## Anti-patterns

- Anything fading up 20px as *the* effect.
- Overshoot, bounce, elastic, spring. A press stops dead.
- Uniform timing: one duration for everything regardless of whether it's a rule, a figure or a line of type.
- A new effect invented for one page. If it isn't in this file, either it extends a pattern here deliberately, or it's a trick.
- Glow or pulsing as urgency. Urgency is *which ink is used*.
- Hidden content that only JavaScript can reveal, outside the `html.js` gate.
- **`data-press` / `data-advance` on nodes a client component creates after mount.** The reveal layer observes what exists when the page loads, so anything rendered later is watched by nothing and stays at its hidden initial state permanently. The flashcard answer did exactly this and never appeared. Client-rendered content animates itself, or not at all.
- A second pinned scene. There is one, it is the chart, and that is what makes it feel earned.
