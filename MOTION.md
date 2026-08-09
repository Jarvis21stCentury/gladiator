# MOTION.md — the press

The implementation of CLAUDE.md's motion principles. Read this before adding any animated element. Every moving thing in the product is one of the named patterns below, or a deliberate extension of one.

## The metaphor

**Nothing.** This is a tool, and the correct amount of motion in a tool is very close to none.

Every effect that survives is a short entrance that is over before your eye arrives, or a hover state. Nothing is continuous, nothing tracks the scroll, and nothing takes the scroll away. A straightedge does not spring back off the paper: no overshoot, no bounce, no easing back.

Two large effects were **deleted** rather than tuned, and both deletions are the point:

- **The pinned chart.** The workload chart used to pin the page for 130% of a viewport while a scrubbed read head swept left to right. It was the best thing in the editorial version of this design and it is wrong for a tool — it cost a screen and a half of scrolling to learn what a 320px chart shows instantly, on a page you opened to answer "is this week bad". The columns now animate in on entry and the readout responds to *pointing at a column* instead.
- **The scroll-velocity layer.** A lerped velocity value ran into a CSS custom property every frame and leaned headings against the direction of travel. As connective tissue across five editorial pages it did real work; in an app it moves the heading you are trying to read while you scroll past it.

If you are about to add something that runs while the user is reading, that is the signal to stop.

## The DNA

One easing family, two tempos, **zero overshoot**.

| Token | Value | Used for |
|---|---|---|
| `--strike` | `cubic-bezier(0.16, 1, 0.3, 1)` | Type, figures, marks — hard arrival, dead stop. |
| `--draw` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Rules extending, meters filling, traces plotting. |
| `--t-micro` | `160ms` | Hover, focus, state swaps. |
| `--t-strike` | `400ms` | The strike tempo. Type and figures. |
| `--t-draw` | `720ms` | The draw tempo. Structure. |

Every duration in the system is roughly **15% shorter** than the letterpress tempo it was first built at. The same choreography, the same easing family, the same zero overshoot — arriving sooner, and therefore out of your way sooner.

Scrubbed scenes use `ease: "none"` — they are driven by the scroll, and adding a curve on top of the user's own hand is what makes scrubbing feel broken.

In GSAP these read as `expo.out` (strike) and `power2/3.out` (draw). Never `back`, `elastic` or `bounce`.

## Architecture

Pages **never import GSAP**. They mark up intent with data attributes; `src/components/press/Press.tsx` owns how any of it moves.

```
data-draw      a rule                → Rule Draw
data-strike    a line of type        → Strike
data-press     a figure or block     → Impression Settle
data-meter     a measured bar        → Meter Fill
data-mark      the page's own title  → Title Rule  (+ Velocity Lean)
```

Two rules make this safe:

1. **Every hidden initial state is scoped to `html.js`**, which an inline script in the document head sets before first paint. No script, nothing hidden — the page is complete, readable static type. This is the difference between a designed page and a blank one.
2. **Reveals use IntersectionObserver, not scroll offsets.** The patterns are registered in the layout, before the route's own scenes mount, and the pinned pressure chart adds over a screen of spacer when it does. Anything holding a measured scroll position would point at the wrong place and never fire. An observer holds no measurement. There is also an explicit flush at the bottom of the document, because an inset root margin can never be satisfied by an element sitting in the last few pixels of the page.

## The patterns

### Title Rule — the signature
· **Trigger:** enters view, 160ms after the line lands · **Choreography:** a weighted accent rule is drawn from the left under **one line per page — the page's own title**. It lands and stays. · **Path:** `scaleX(0 → 1)`, origin left, `power4.out`, 0.54s · **Why:** the line is written, then it is ruled under. The delay is the whole point — a rule that arrives with the words is just a border. It is the only mark in the system carrying no data, and it earns that by being the thing a ruled page is made of.

Used via `<Plate mark>`. The rule is an empty `aria-hidden` element, so nothing is duplicated into the accessibility tree or the clipboard, and there is nothing to keep in sync with the text.

**Selective on purpose, and this is a rule, not a default.** `mark` is off by default; one line per page. A rule under every heading is just an underline and stops meaning anything. It also never goes under a line already carrying a signal ink — which is why `Verdict` is never ruled.

> This replaced an acid-chartreuse highlighter band swept *behind* the same line. The
> gesture was right and the colour was not — neon reads as a game, not as school — and a
> band behind type is always in tension with the type. It also animated `background-size`,
> a paint rather than a composite; this is a plain transform and costs nothing.

### Velocity Lean — the flow layer
· **Trigger:** scroll velocity (continuous) · **Choreography:** one shared velocity value, lerped and decaying to zero at rest, simultaneously tips every page title (`-4px`) and every outlined margin serial (`-9px`) against the direction of travel, and stretches the through-line's head into a streak. · **Path:** `translate3d(0, vel * -Npx, 0)`; head `scaleY(1 + vel² * 9)`, lerp `0.12` · **Why:** this is the connective tissue — five sections reading as one sheet moving under your hand rather than a playlist of separate effects. It costs one CSS custom-property write per frame no matter how much is on screen.

Amplitudes are deliberately small, and were reduced further when the design moved to the notebook. The effect should be felt at the edge of vision while you scroll and be completely absent the moment you stop to read.

Deliberately **not** a skew or rotation: type that shears while you scroll reads as a rendering fault, and this design's whole claim is that it is squared up. The head uses `vel²` rather than `abs(vel)` so it reacts identically in both directions without depending on CSS `abs()`, which isn't universally available yet.

### Strike
· **Trigger:** enters view · **Choreography:** type rises into place and stops dead. · **Path:** `translateY(0.4em → 0)` + opacity, `expo.out`, 0.52s, 50ms stagger · **Why:** a line being written, not set.

> This used to mask the line with `overflow: hidden` and slide it up from behind its own
> rule, which looked better and clipped every heading's right edge for the whole time it
> animated — plus permanently on any heading whose mask release didn't run. Text that gets
> sliced is a worse failure than a plainer entrance is a loss. Nothing in this pattern can
> clip anything now.

### Card Reveal
· **Trigger:** the answer is asked for · **Path:** a local `@keyframes reveal` — opacity and `0.35rem`, 220ms · **Why:** the flashcard answer is created by a client component *after* the observer layer has been wired, so it cannot use `data-press` and has to animate itself. Fast on purpose: this is the thing you were waiting for.

### Kinetic Masthead
· **Trigger:** load · **Choreography:** the one verdict line per page splits to characters and strikes individually with a slight lean. · **Path:** `yPercent: 115 → 0`, `skewY: 3 → 0`, 0.66s, 13ms per character · **Why:** spending the kinetic budget on exactly one line keeps it an event; doing it to every heading makes it wallpaper. It should feel *written* — you should not be able to watch it arrive letter by letter, only notice that it did. Lives in `Verdict.tsx`, and never takes the title rule: this line already carries the status ink, and the accent is the other attention colour.

### Rule Draw
· **Trigger:** enters view · **Path:** `scaleX(0 → 1)` from the left, `power2.out`, 0.72s, 45ms stagger · **Why:** structure arrives before content. Rules sit above the type they introduce, so a section is already framed by the time anything strikes into it — that handoff is what stops sections reading as a stack of unrelated blocks.

### Docket Advance — removed
Rows used to be revealed by animating `clip-path: inset(0 100% 0 0)` open, in reading direction.

**It stranded content, and it was deleted rather than fixed.** The reveal layer observes what exists when the page loads, so any row React created *later* — a task just added, a list re-rendered by `revalidatePath` after ticking something off — was watched by nothing and stayed at that initial state permanently: fully clipped, invisible, and impossible to click. The anti-pattern list below had this written down before the bug was written; it was reintroduced anyway, on the one component whose entire job is rows that appear after mount.

A `MutationObserver` would have fixed it. Deleting it was better: it was the only reveal in the system that hides content by *clipping* it, it is decoration on a list you are trying to read, and a tool should not animate rows in at all. Nothing replaces it — rows are simply there.

### Impression Settle
· **Trigger:** enters view · **Path:** `y: 0.6rem → 0`, `scale: 1.012 → 1`, opacity in, `expo.out`, 0.58s, 45ms stagger · **Why:** a block set down on the page. The default for figures and blocks that aren't type or rules.

### Tally
· **Trigger:** enters view, once · **Path:** count to value on a quartic ease-out; duration scales with magnitude (380ms–1.1s) · **Why:** a figure should read as a reading being taken, not as a number that was always there. Tabular figures mean the element never changes width mid-count.

### Meter Fill / Trace Draw
· **Trigger:** enters view · **Path:** `scaleX(0 → 1)` / `stroke-dashoffset → 0`, draw tempo · **Why:** a measurement being laid down. The trace is a rule that happens to know something.

### Waterline Flood — the signature scene
· **Trigger:** scrubbed, pinned (`+=130%`, `anticipatePin: 1`) · **Choreography:** one scrubbed value sweeps a read head left to right; day columns strike down from the top rule as it reaches them, the overload segment floods flare a beat behind its own column, and the margin readout re-prints to whichever day the head is over. · **Why:** the one thing this product knows that a calendar does not is how much of the time you have is already spoken for — so it is the biggest thing on the site and the only place the scroll is taken away from you. Four things driven by one source is what makes it read as a single instrument.

Pins below the nameplate by measuring it, not by a hard-coded offset.

### Sheet Slip — transitions
· **Trigger:** click on any `data-slip` anchor · **Path:** `yPercent: 100 → 0`, route changes underneath, `→ -100`, `power4.inOut`, 320ms each half. Its leading edge is a 3px accent rule, so a navigation reads as one rule drawn up over the page — a page's title rule at page scale. · **Why:** covers the seam. Without it a navigation is a flash followed by a page whose entrances have already half-played. Delegated from the document, so any `data-slip` link anywhere gets it. Modified clicks, new tabs and external links are left alone.

### Through-Line Rail
· **Trigger:** scroll progress (continuous) · **Choreography:** a hairline in the gutter of every page, filling with page progress, inked with the system's current level. · **Why:** the single most effective "one document" device. Whatever page you are on, the same rail runs down the margin at the same colour the front page was.

### Ink Pressure — micro-interactions
· **Trigger:** hover / focus · **Path:** controls flood the **accent** up from the baseline (`scaleY(0 → 1)`, origin bottom); links take the accent and thicken their own rule; the current masthead section draws an accent rule under itself from the left, and is already ruled before you touch it; colophon entries extend a rule to full width · **Why:** pressure, not a colour swap — and the thing under your cursor gets the same blue as the page you are on and the section you are in, which is what makes "where am I" answerable without reading a word. Nothing in this system changes colour alone on hover.

The flood colour is `--control-fill` (default `--accent`) with `--control-on` for the label on top of it. The rating buttons in a review session are why they are separate vars: "again" floods urgent and "easy" floods affirmative.

## Accessibility

Non-negotiable, and built alongside each effect rather than after:

- `prefers-reduced-motion: reduce` gets a complete branch in `Press.tsx` that sets every final state immediately, skips the pin and scrub entirely, and drops the velocity lean. The title rule is shown already at full width.
- Real, selectable text stays in the DOM through every split and duplicate.
- **Anything split to characters needs an explicit `aria-label`.** The accessible name is computed from the element's contents, and per-character spans get joined with spaces — without the label the masthead is announced `"C h e m i s t r y — H o n o r s"`, letter by letter. The label carries the sentence; the split glyphs are `aria-hidden` once the split succeeds, and only then.
- The title rule is an empty `aria-hidden` element — there is no duplicated text to reach the accessibility tree or the clipboard.
- Nothing relies on the accent to convey state. The current masthead section also carries `aria-current="page"`; an accented control also carries its own label.
- The pinned scene releases cleanly and never traps the scroll; it is unpinned below `48rem`.
- Nothing conveys meaning by colour alone — marks are filled vs hollow vs struck through, and every bar carries length as well as ink.

## Anti-patterns

- Anything fading up 20px as *the* effect.
- Overshoot, bounce, elastic, spring. A press stops dead.
- Uniform timing: one duration for everything regardless of whether it's a rule, a figure or a line of type.
- A new effect invented for one page. If it isn't in this file, either it extends a pattern here deliberately, or it's a trick.
- Glow or pulsing as urgency. Urgency is *which ink is used*.
- The accent on more than one thing per region, or on anything that is not "where you are / what you are about to press". It is the direction colour, not a highlight to sprinkle.
- Motion loud enough to notice while reading. This is a school tool; the reveal should be over before the eye arrives.
- Hidden content that only JavaScript can reveal, outside the `html.js` gate.
- **`data-press` / `data-advance` on nodes a client component creates after mount.** The reveal layer observes what exists when the page loads, so anything rendered later is watched by nothing and stays at its hidden initial state permanently. The flashcard answer did exactly this and never appeared. Client-rendered content animates itself, or not at all.
- A second pinned scene. There is one, it is the chart, and that is what makes it feel earned.
