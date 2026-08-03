"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

import { minutesLabel } from "@/lib/format";
import { STATUS_VAR, type StatusLevel } from "@/lib/status";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Waterline Flood — the signature scene (MOTION.md).
 *
 * The one thing this product knows that a calendar does not is *how much of the
 * time you actually have is already spoken for*. So that is the biggest thing on
 * the site, and it is the only place the page takes the scroll away from you.
 *
 * Each day hangs down from the top rule; its length is the work due. Across each
 * column is a tick at the hours that day actually has free — its waterline. The
 * part of a column that punches past its own waterline is the part that does not
 * fit, and it prints in vermilion. Nothing about that needs a legend.
 *
 * Choreography: the section pins, and one scrubbed value sweeps a read head left
 * to right. Columns strike down as the head reaches them, the overload segment
 * floods a beat later, and the margin readout re-prints to whichever day the head
 * is over. One source of truth driving four things is what makes it read as a
 * single instrument rather than four animations that happen to share a section.
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
  const headRef = useRef<HTMLSpanElement>(null);
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

      const write = (progress: number) => {
        const index = Math.min(
          days.length - 1,
          Math.max(0, Math.round(progress * (days.length - 1))),
        );
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
              ? "var(--vermilion)"
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

      const media = gsap.matchMedia();

      media.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          wide: "(min-width: 48rem)",
        },
        (context) => {
          const { motion, wide } = context.conditions as {
            motion: boolean;
            wide: boolean;
          };

          if (!motion) {
            // Reduced motion: the chart is simply printed, complete, no pin,
            // and the readout keeps the server's reading of today — which is
            // the useful static answer, and already on screen.
            gsap.set([columns, floods], { scaleY: 1 });
            gsap.set(headRef.current, { xPercent: 0, autoAlpha: 0 });
            return;
          }

          gsap.set(columns, { scaleY: 0 });
          gsap.set(floods, { scaleY: 0 });

          // Pin below the nameplate, not under it. Measured rather than
          // hard-coded, because the masthead's height is set by its own type.
          const masthead = () =>
            Math.round(
              document
                .querySelector("[data-masthead]")
                ?.getBoundingClientRect().height ?? 0,
            );

          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: el,
              start: () => `top top+=${masthead()}`,
              end: "+=130%",
              // Pinning is worth it here and nowhere else on the site: the whole
              // point is watching three weeks assemble against their waterlines.
              pin: wide,
              anticipatePin: 1,
              scrub: 0.6,
              invalidateOnRefresh: true,
              onUpdate: (self) => write(self.progress),
            },
          });

          // Webfonts land after this scene is built and shift everything above
          // it, which would leave the pin starting in the wrong place.
          document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => {});

          timeline
            .to(headRef.current, { xPercent: 100 * days.length, ease: "none" }, 0)
            .to(
              columns,
              { scaleY: 1, ease: "power3.out", stagger: { each: 0.6 / days.length } },
              0,
            )
            .to(
              floods,
              {
                scaleY: 1,
                ease: "power2.out",
                // A beat behind its own column: the work lands, *then* you see
                // the part of it that does not fit.
                stagger: { each: 0.6 / days.length },
              },
              0.06,
            );
        },
      );

      return () => media.revert();
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
          /* Sized so the pinned scene fills the screen it has taken over.
             A pinned section with a third of the viewport left empty under it
             reads as a bug rather than as a held moment. */
          style={{ height: "clamp(240px, 60vh, 620px)" }}
        >
          {/* The read head — what the margin readout is currently reporting.
              Solid and marked at the top rather than a faint dashed hairline:
              at 50% ink it disappeared against the day dividers, which left the
              readout looking like it was describing nothing in particular. */}
          <span
            ref={headRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-10"
            style={{ width: `${100 / days.length}%` }}
          >
            <span className="absolute inset-y-0 left-0 w-px bg-ink" />
            <span className="absolute -left-[3px] top-0 h-[7px] w-[7px] bg-ink" />
          </span>

          {days.map((day) => {
            const fits = Math.min(day.loadMinutes, day.capacityMinutes);
            const over = Math.max(0, day.loadMinutes - day.capacityMinutes);

            return (
              <div
                key={day.offset}
                className="relative min-w-0 flex-1 border-r border-rule/50 last:border-r-0"
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
              column = work due · dashed = hours free that day · vermilion = over
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
