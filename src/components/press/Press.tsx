"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { STATUS_VAR, type StatusLevel } from "@/lib/status";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * The press.
 *
 * One controller runs every named pattern in MOTION.md that isn't a bespoke
 * scene. Everything is a short entrance and nothing is continuous: this is a
 * tool, and motion that is still happening while you are reading is motion
 * working against the person using it.
 *
 * Pages never import GSAP. They mark up intent — `data-draw`, `data-strike`,
 * `data-press` — and this decides how any of it moves. That is
 * what stops five pages drifting into five motion languages, and it means a new
 * section is animated correctly by default rather than by remembering to.
 *
 * Everything it touches is hidden only behind `html.js`, and that class is set
 * by an inline script in the document head. If this component never mounts, or
 * GSAP fails to load, the page is complete and readable.
 */

/** How far into the viewport an element must come before it is printed. */
const ROOT_MARGIN = "0px 0px -8% 0px";

export function Press({ level }: { level: StatusLevel }) {
  const pathname = usePathname();
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = document.documentElement;
      root.style.setProperty("--status", STATUS_VAR[level]);

      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: reduce)", () => {
        /*
         * Show everything, immediately, in its final state.
         *
         * `document.querySelectorAll` rather than passing selector strings to
         * GSAP: this hook runs inside a `useGSAP` scope, and GSAP resolves
         * selector text *within that scope* — which here is an empty div. Bare
         * strings match nothing, fail silently, and leave the reduced-motion
         * branch doing precisely nothing at all.
         */
        const all = (selector: string) => document.querySelectorAll(selector);

        gsap.set(all("[data-draw]"), { scaleX: 1 });
        gsap.set(all("[data-strike] > :not(.plate__rule)"), { y: 0, opacity: 1 });
        gsap.set(all("[data-press]"), { opacity: 1, y: 0, scale: 1 });
        gsap.set(all("[data-meter]"), { scaleX: 1 });
        gsap.set(all("[data-mark] .plate__rule"), { scaleX: 1 });
      });

      media.add("(prefers-reduced-motion: no-preference)", () => {
        const observers: IntersectionObserver[] = [];

        /*
         * Reveals are driven by IntersectionObserver rather than by scroll
         * position, and that is a deliberate correctness choice, not a
         * preference.
         *
         * These patterns are registered once in the layout, for the whole page,
         * but the route's own scenes mount afterwards — and the pinned pressure
         * chart adds well over a screen of spacer when it does. Anything that
         * had already measured a scroll offset would be pointing at the wrong
         * place, and every reveal below the chart would sit at its hidden
         * initial state forever. An observer never holds a measurement: the
         * browser reports what is actually on screen, whatever moved since.
         *
         * Elements that arrive together are still animated together — that is
         * what one observer callback *is* — so the staggered choreography is
         * unchanged. They are sorted into reading order first, because the
         * observer makes no promise about entry order and a stagger that runs
         * bottom-up looks like a mistake.
         */
        const inReadingOrder = (elements: Element[]) =>
          elements.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.top - rectB.top || rectA.left - rectB.left;
          });

        const flushes: (() => void)[] = [];

        const reveal = (
          selector: string,
          run: (elements: Element[]) => void,
        ) => {
          const pending = new Set(document.querySelectorAll(selector));
          if (!pending.size) return;

          const observer = new IntersectionObserver(
            (entries, self) => {
              const arrived: Element[] = [];

              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                self.unobserve(entry.target);
                pending.delete(entry.target);
                arrived.push(entry.target);
              }

              if (arrived.length) run(inReadingOrder(arrived));
            },
            { rootMargin: ROOT_MARGIN },
          );

          for (const element of pending) observer.observe(element);
          observers.push(observer);

          /*
           * The bottom-of-document case, which an inset root margin cannot
           * reach on its own: an element sitting inside the last few pixels of
           * the page never clears a negative bottom margin, because there is no
           * scroll left to give it. Left alone it stays at its hidden initial
           * state permanently — the exact blank-content failure this whole
           * layer is built to avoid. So when the page is scrolled as far as it
           * goes, anything still pending and on screen is printed.
           */
          flushes.push(() => {
            const arrived: Element[] = [];

            for (const element of pending) {
              const rect = element.getBoundingClientRect();
              if (rect.top < window.innerHeight && rect.bottom > 0) {
                observer.unobserve(element);
                pending.delete(element);
                arrived.push(element);
              }
            }

            if (arrived.length) run(inReadingOrder(arrived));
          });
        };

        /* ---- Rule Draw ---------------------------------------------------
           Structure arrives before content. Every hairline draws from the left,
           and because rules sit above the type they introduce, a section is
           already framed by the time anything strikes into it.

           Everything in this block is roughly half the duration it ran at when
           this was an editorial layout. A document can afford a 0.9s reveal
           because you are reading it top to bottom; a tool cannot, because you
           opened it to find one date and every frame of animation is a frame
           you are waiting. Nothing here should be watchable — you should only
           notice that the page assembled rather than blinked. */
        reveal("[data-draw]", (batch) =>
          gsap.to(batch, {
            scaleX: 1,
            duration: 0.4,
            ease: "power2.out",
            stagger: 0.02,
          }),
        );

        /* ---- Strike ------------------------------------------------------
           Type rises into place and stops dead. Deliberately not masked: see
           the note in globals.css — the mask clipped headings while they moved. */
        reveal("[data-strike]", (batch) =>
          gsap.to(
            batch.map(
              (el) => el.querySelector(":scope > :not(.plate__rule)") ?? el,
            ),
            {
              y: 0,
              opacity: 1,
              duration: 0.32,
              ease: "expo.out",
              stagger: 0.025,
            },
          ),
        );

        /* ---- Title Rule — the signature -----------------------------------
           The accent rule is drawn from the left under the page's title.
           Deliberately *after* the type: the line is written, then it is ruled
           under. `power4.out` for a stroke that leaves fast and settles slowly.

           A composited transform rather than the paint-bound background sweep
           this replaced, so it is cheap enough to never need a caveat. */
        reveal("[data-mark] .plate__rule", (batch) =>
          gsap.to(batch, {
            scaleX: 1,
            duration: 0.36,
            ease: "power4.out",
            delay: 0.1,
          }),
        );

        /* ---- Impression Settle -------------------------------------------- */
        reveal("[data-press]", (batch) =>
          gsap.to(batch, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.36,
            ease: "expo.out",
            stagger: 0.03,
          }),
        );

        /* ---- Meters ------------------------------------------------------- */
        reveal("[data-meter]", (batch) => {
          gsap.set(batch, { scaleX: 0 });
          gsap.to(batch, {
            scaleX: 1,
            duration: 0.5,
            ease: "power3.out",
            stagger: 0.03,
          });
        });

        /*
         * The scroll-velocity layer is gone.
         *
         * It lerped a scroll-velocity value into a CSS custom property every
         * frame, which leaned page titles and margin serials against the
         * direction of travel and stretched the scroll rail's head into a
         * streak. As connective tissue across five editorial pages it did real
         * work. In an app shell it is the wrong instinct outright: everything it
         * moved is either gone (the rail, the serials) or is a heading you are
         * trying to read *while* scrolling past it. Deleting it also takes a
         * per-frame style write off every page in the product.
         */

        const atBottom = () => {
          if (
            window.scrollY + window.innerHeight >=
            document.documentElement.scrollHeight - 4
          ) {
            for (const flush of flushes) flush();
          }
        };

        window.addEventListener("scroll", atBottom, { passive: true });
        atBottom();

        return () => {
          for (const observer of observers) observer.disconnect();
          window.removeEventListener("scroll", atBottom);
        };
      });

      return () => media.revert();
    },
    { scope, dependencies: [pathname, level], revertOnUpdate: true },
  );

  return <div ref={scope} aria-hidden="true" />;
}
