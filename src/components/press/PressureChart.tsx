"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

import { minutesLabel } from "@/lib/format";
import { STATUS_VAR, type StatusLevel } from "@/lib/status";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * The workload chart.
 *
 * The one thing this product knows that a calendar does not is *how much of the
 * time you actually have is already spoken for*. Each day hangs down from the top
 * rule; its length is the work due. Across each column is a tick at the hours
 * that day actually has free — its waterline. The part of a column that punches
 * past its own waterline is the part that does not fit, and it prints in the
 * urgent ink. Nothing about that needs a legend.
 *
 * ## It used to pin the page, and no longer does
 *
 * This was the site's signature scene: the section pinned, took the scroll away
 * for 130% of a viewport, and a scrubbed read head swept left to right while
 * columns struck down and overload segments flooded behind it. It was the best
 * thing in the editorial version of this design.
 *
 * It is wrong for a tool, and it was the last thing left fighting the person
 * using one. Scroll-jacking a full viewport to reveal fourteen bars costs you a
 * screen and a half of scrolling to learn something a 320px chart shows
 * instantly — and this is a page opened to answer "is this week bad", not a
 * page to be walked through. So the columns now animate in on entry like every
 * other reveal in the product, the chart is a fixed height inside the content
 * column, and the readout reports today rather than tracking a scroll position.
 */

export interface PressureDay {
  date: Date;
  offset: number;
  loadMinutes: number;
  capacityMinutes: number;
  level: StatusLevel;
  itemCount: number;
}

export function PressureChart({
  days,
  totalMinutes,
}: {
  days: PressureDay[];
  totalMinutes: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const loadRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLSpanElement>(null);

  // One scale for load and capacity, so a column and its waterline are
  // comparable by eye — which is the entire point of the chart.
  const ceiling = Math.max(
    60,
    ...days.map((day) => Math.max(day.loadMinutes, day.capacityMinutes)),
  );

  const overloaded = days.filter(
    (day) => day.loadMinutes > day.capacityMinutes,
  ).length;

  // Today's reading, for the server-rendered state of the margin readout.
  const first = days[0];
  const firstNote =
    !first || first.itemCount === 0
      ? "nothing due"
      : `${first.itemCount} item${first.itemCount === 1 ? "" : "s"} · ${minutesLabel(
          first.capacityMinutes,
        )} free`;

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;

      const columns = gsap.utils.toArray<HTMLElement>("[data-column]", el);
      const floods = gsap.utils.toArray<HTMLElement>("[data-flood]", el);

      /*
       * Repoint the readout at a day.
       *
       * This used to be driven by the pinned scene's scrub — the readout tracked
       * whatever the scroll had swept the read head over. With the pin gone it is
       * driven by pointing at a column instead, which is the same information on
       * demand rather than as a function of how far you have scrolled, and it is
       * what someone actually wants: "what is that tall red one".
       */
      const write = (index: number) => {
        const day = days[index];
        if (!day) return;

        if (dateRef.current) {
          dateRef.current.textContent = day.date.toLocaleDateString([], {
            weekday: "long",
            month: "short",
            day: "numeric",
          });
        }
        if (loadRef.current) {
          loadRef.current.textContent = minutesLabel(day.loadMinutes);
          loadRef.current.style.color =
            day.loadMinutes > day.capacityMinutes
              ? "var(--flare)"
              : "var(--ink)";
        }
        if (noteRef.current) {
          noteRef.current.textContent =
            day.itemCount === 0
              ? "nothing due"
              : `${day.itemCount} item${day.itemCount === 1 ? "" : "s"} · ${minutesLabel(
                  day.capacityMinutes,
                )} free`;
        }
      };

      /*
       * Hover-to-read. Delegated from the chart root rather than bound per
       * column, so there is one listener regardless of how many days are shown,
       * and it survives the columns being re-rendered.
       *
       * Pointer events only: this is an enhancement over a readout that already
       * shows today, so a keyboard or touch user loses nothing. Wiring it up as
       * real focusable controls would put fourteen tab stops in front of the
       * rest of the page to restate numbers the timetable lists in full.
       */
      const onPoint = (event: PointerEvent) => {
        const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>(
          "[data-day]",
        );
        if (!cell) return;

        const index = Number(cell.dataset.day);
        if (Number.isInteger(index)) write(index);
      };

      const onLeave = () => write(0);

      el.addEventListener("pointermove", onPoint);
      el.addEventListener("pointerleave", onLeave);

      const media = gsap.matchMedia();

      media.add(
        // `wide` used to gate the pin, which was only ever applied above 48rem.
        // With no pin there is nothing width-dependent left to decide.
        { motion: "(prefers-reduced-motion: no-preference)" },
        (context) => {
          const { motion } = context.conditions as { motion: boolean };

          if (!motion) {
            // Reduced motion: the chart is simply printed, complete, no pin,
            // and the readout keeps the server's reading of today — which is
            // the useful static answer, and already on screen.
            gsap.set([columns, floods], { scaleY: 1 });
            return;
          }

          gsap.set(columns, { scaleY: 0 });
          gsap.set(floods, { scaleY: 0 });

          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: el,
              // Fires once, when the chart is properly on screen. No pin, no
              // scrub, no scroll taken from the reader.
              start: "top 85%",
              once: true,
            },
          });

          timeline
            .to(columns, {
              scaleY: 1,
              duration: 0.5,
              ease: "power3.out",
              stagger: { each: 0.022 },
            })
            .to(
              floods,
              {
                scaleY: 1,
                duration: 0.45,
                ease: "power2.out",
                // A beat behind its own column: the work lands, *then* you see
                // the part of it that does not fit.
                stagger: { each: 0.022 },
              },
              0.1,
            );
        },
      );

      return () => {
        el.removeEventListener("pointermove", onPoint);
        el.removeEventListener("pointerleave", onLeave);
        media.revert();
      };
    },
    { scope: root, dependencies: [days] },
  );

  return (
    <div ref={root} className="relative">
      <div className="sheet">
        {/* The readout, printed in the margin and re-set as the head sweeps. */}
        <div className="hang items-end pb-8">
          <p className="rubric hidden lg:block">Read</p>
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
            {/*
              Rendered on the server at today's reading, not left empty for the
              client to fill. These spans used to ship blank, which meant that
              with JavaScript off the chart kept its whole readout — the date,
              the note and the figure — permanently empty, under a heading that
              said "Read". The sweep overwrites this the moment it runs.
            */}
            <div>
              <span ref={dateRef} className="display display--md block">
                {first?.date.toLocaleDateString([], {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span ref={noteRef} className="docket mt-2 block">
                {firstNote}
              </span>
            </div>
            <div className="text-right">
              <p className="rubric">Work due</p>
              <span ref={loadRef} className="fig--lg fig block">
                {minutesLabel(first?.loadMinutes ?? 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* The chart itself runs full-bleed — it is the widest thing in the
          product, and cutting it to the text measure would waste the one place
          the shape of three weeks is legible at a glance. */}
      <div className="relative border-t border-ink/70">
        <div
          /* Clipped: the read head finishes its sweep flush with the last day,
             which puts its own width past the right edge and would otherwise
             widen the document and give the whole page a horizontal scrollbar. */
          className="relative flex items-stretch overflow-hidden"
          /* A chart, not a scene. Tall enough to compare fourteen columns and
             their waterlines by eye, short enough that the section under it is
             visible at the same time.
             (Formerly sized to fill a pinned viewport; a section with a third
             of the screen left empty under it
             reads as a bug rather than as a held moment. */
          style={{ height: "clamp(200px, 30vh, 300px)" }}
        >
          {days.map((day, index) => {
            const fits = Math.min(day.loadMinutes, day.capacityMinutes);
            const over = Math.max(0, day.loadMinutes - day.capacityMinutes);

            return (
              <div
                key={day.offset}
                data-day={index}
                className="relative min-w-0 flex-1 border-r border-rule/50 transition-colors duration-150 last:border-r-0 hover:bg-accent-soft"
              >
                {/* The waterline: how much of this day is actually free. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-dashed border-ink-faint"
                  style={{ top: `${(day.capacityMinutes / ceiling) * 100}%` }}
                />

                {/* The work that fits. Strikes down from the top rule. */}
                <span
                  data-column=""
                  className="absolute inset-x-[18%] top-0 origin-top"
                  style={{
                    height: `${(fits / ceiling) * 100}%`,
                    background: "var(--ink)",
                    opacity: day.loadMinutes > 0 ? 0.88 : 0,
                  }}
                />

                {/* The work that does not. */}
                <span
                  data-flood=""
                  className="absolute inset-x-[18%] origin-top"
                  style={{
                    top: `${(day.capacityMinutes / ceiling) * 100}%`,
                    height: `${(over / ceiling) * 100}%`,
                    background: STATUS_VAR.urgent,
                  }}
                />

                <span
                  className="absolute inset-x-0 bottom-2 text-center text-[0.5625rem] leading-none"
                  style={{
                    fontFamily: "var(--font-mono)",
                    // --ink-soft, not --ink-faint: these are figures to be read,
                    // and the faint ink is for marks and waterlines.
                    color: day.offset === 0 ? "var(--ink)" : "var(--ink-soft)",
                  }}
                >
                  {day.date.getDate()}
                </span>
              </div>
            );
          })}
        </div>

        <div className="border-t border-ink/70">
          <div className="sheet flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 py-4">
            <p className="rubric">
              column = work due · dashed = hours free · red = over · point at a
              day to read it
            </p>
            <p className="docket">
              {minutesLabel(totalMinutes)} across {days.length} days
              {overloaded > 0
                ? ` · ${overloaded} day${overloaded === 1 ? "" : "s"} over`
                : " · all days fit"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
