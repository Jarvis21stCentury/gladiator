"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";

import { STATUS_VAR, type StatusLevel } from "@/lib/status";

/**
 * The masthead verdict — the one line on the dashboard that says how school is
 * actually going, and the only per-character strike in the product.
 *
 * Characters rise from behind their own line with a slight lean, the way a hand
 * writes a line out fast. Spending the kinetic budget on exactly one line per
 * session is what keeps it feeling like an event; doing it to every heading
 * would make it wallpaper.
 *
 * Deliberately never given the title rule. This line is inked with the system's
 * current status whenever that isn't calm, and the accent is the product's other
 * attention colour — a blue rule under a line already set in urgent red is two
 * things pointing at once, which is one too many. The accent belongs to the page
 * title; the status ink belongs here.
 *
 * The text is real, selectable text before, during and after — the splitter only
 * ever wraps existing nodes, and if it fails the sentence is already on screen.
 */
export function Verdict({
  text,
  level,
  className = "",
}: {
  text: string;
  level: StatusLevel;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const face = el.querySelector<HTMLElement>(".plate__face");
    if (!face) return;

    let cleanup: (() => void) | undefined;

    // Dynamically imported and fully guarded: a splitter that throws must never
    // take the masthead — or anything after it on the page — down with it.
    void (async () => {
      try {
        const { default: SplitType } = await import("split-type");

        const split = new SplitType(face, {
          types: "lines,chars",
          lineClass: "strike-line",
        });

        if (!split.chars?.length) return;

        /*
         * Hide the split glyphs from assistive tech — the `aria-label` above is
         * already carrying the real sentence, and this stops a browse-mode
         * reader walking into forty individual character elements. Only applied
         * once the split has actually succeeded, so unsplit text is never
         * hidden from anyone.
         */
        face.setAttribute("aria-hidden", "true");

        const timeline = gsap.timeline();

        timeline.from(split.chars, {
          yPercent: 115,
          skewY: 3,
          // Quicker and tighter than the press it replaced (0.78s / 16ms). The
          // line should feel written, not set — you should not be able to watch
          // it arrive letter by letter, only notice that it did.
          duration: 0.66,
          ease: "expo.out",
          stagger: { each: 0.013 },
        });

        cleanup = () => {
          timeline.kill();
          split.revert();
          face.removeAttribute("aria-hidden");
        };
      } catch {
        // Leave the line as plain, already-visible type.
      }
    })();

    return () => cleanup?.();
  }, [text]);

  return (
    <h1
      ref={ref}
      className={`plate display ${className}`}
      /*
       * Splitting to characters wraps every glyph in its own inline element, and
       * the accessible-name computation joins those with spaces — so the most
       * important line in the product was being announced letter by letter:
       * "C h e m i s t r y — H o n o r s". An explicit label wins over the
       * computed contents, split or not, while the real text stays in the DOM
       * and selectable.
       */
      aria-label={text}
      style={{ color: level === "calm" ? undefined : STATUS_VAR[level] }}
    >
      <span className="plate__face">{text}</span>
    </h1>
  );
}
