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
 * scene, plus the two shared sources that make the whole page behave as one
 * organism: scroll *velocity* (which pulls the ghost plates out of register) and
 * scroll *progress* (which fills the through-line in the margin).
 *
 * Pages never import GSAP. They mark up intent — `data-draw`, `data-strike`,
 * `data-advance`, `data-press` — and this decides how any of it moves. That is
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
        gsap.set(all("[data-strike] > :not(.plate__ghost)"), { y: 0, opacity: 1 });
        gsap.set(all("[data-advance]"), { clipPath: "inset(0 0% 0 0)" });
        gsap.set(all("[data-press]"), { opacity: 1, y: 0, scale: 1 });
        gsap.set(all("[data-meter]"), { scaleX: 1 });
        gsap.set(all(".plate__ghost"), { "--off": "0rem" });
        root.style.setProperty("--progress", "1");
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
           already framed by the time anything strikes into it. */
        reveal("[data-draw]", (batch) =>
          gsap.to(batch, {
            scaleX: 1,
            duration: 0.88,
            ease: "power2.out",
            stagger: 0.06,
          }),
        );

        /* ---- Press Strike ------------------------------------------------
           Type rises into place and stops dead. Deliberately not masked: see
           the note in globals.css — the mask clipped headings while they moved. */
        reveal("[data-strike]", (batch) =>
          gsap.to(
            batch.map(
              (el) => el.querySelector(":scope > :not(.plate__ghost)") ?? el,
            ),
            {
              y: 0,
              opacity: 1,
              duration: 0.62,
              ease: "expo.out",
              stagger: 0.07,
            },
          ),
        );

        /* ---- Plate Registration ------------------------------------------ */
        reveal(".plate__ghost", (batch) =>
          gsap.to(batch, {
            "--off": "0rem",
            duration: 1.1,
            ease: "expo.out",
            stagger: 0.05,
          }),
        );

        /* ---- Docket Advance ----------------------------------------------
           Rows are revealed along their own rule rather than fading up. Reading
           direction, and much faster to scan than a stack of independent fades. */
        reveal("[data-advance]", (batch) =>
          gsap.to(batch, {
            clipPath: "inset(0 0% 0 0)",
            duration: 0.66,
            ease: "power3.out",
            stagger: 0.045,
          }),
        );

        /* ---- Impression Settle -------------------------------------------- */
        reveal("[data-press]", (batch) =>
          gsap.to(batch, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.7,
            ease: "expo.out",
            stagger: 0.06,
          }),
        );

        /* ---- Meters ------------------------------------------------------- */
        reveal("[data-meter]", (batch) => {
          gsap.set(batch, { scaleX: 0 });
          gsap.to(batch, {
            scaleX: 1,
            duration: 0.9,
            ease: "power3.out",
            stagger: 0.07,
          });
        });

        /* ---- Misregistration Drift + through-line -------------------------
           The two shared sources. One velocity value pulls every ghost plate on
           the page out of register at the same moment and lets them settle back
           when you stop; one progress value fills the margin rail. Piping both
           through CSS custom properties means the reactive layer costs a single
           style write per frame no matter how much is on screen. */
        let target = 0;
        let current = 0;

        const velocity = ScrollTrigger.create({
          onUpdate: (self) => {
            target = gsap.utils.clamp(-1, 1, self.getVelocity() / 3200);
          },
        });

        const progress = ScrollTrigger.create({
          start: 0,
          end: "max",
          onUpdate: (self) =>
            root.style.setProperty("--progress", self.progress.toFixed(4)),
        });

        const tick = () => {
          // getVelocity only reports while scrolling, so the target has to decay
          // on its own or the plates would stay separated at rest.
          target *= 0.9;
          current += (target - current) * 0.12;
          if (Math.abs(current) < 0.0005) current = 0;
          root.style.setProperty("--vel", current.toFixed(4));
        };

        gsap.ticker.add(tick);

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
          gsap.ticker.remove(tick);
          velocity.kill();
          progress.kill();
          root.style.setProperty("--vel", "0");
        };
      });

      return () => media.revert();
    },
    { scope, dependencies: [pathname, level], revertOnUpdate: true },
  );

  return <div ref={scope} aria-hidden="true" />;
}
