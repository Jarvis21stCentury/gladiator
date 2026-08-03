"use client";

import { useEffect, useRef } from "react";

import { STATUS_VAR, type StatusLevel } from "@/lib/status";

interface TracePoint {
  date: Date;
  gradePercent: number;
}

/**
 * The grade trace — a plotted line on a ruled field.
 *
 * SVG rather than canvas on purpose: the line inherits the ink through CSS, so
 * it inverts with the plate for free, and it stays crisp at any zoom. It draws
 * itself in left to right on entry, which is the same gesture as every rule on
 * the page — the trace is a rule that happens to know something.
 */
export function Trace({
  points,
  level = "calm",
  height = 110,
}: {
  points: TracePoint[];
  level?: StatusLevel;
  height?: number;
}) {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length === 0) return;

    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        path.style.transition =
          "stroke-dashoffset var(--t-draw) var(--draw)";
        path.style.strokeDashoffset = "0";
      },
      { rootMargin: "0px 0px -10% 0px" },
    );

    observer.observe(path);
    return () => observer.disconnect();
  }, [points]);

  if (points.length < 2) {
    return (
      <p className="docket py-6">
        Not enough grade history yet — the trace needs two checks.
      </p>
    );
  }

  const values = points.map((point) => point.gradePercent);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat run would otherwise divide by zero and draw on the top edge.
  const span = Math.max(4, max - min);
  const lo = min - (span - (max - min)) / 2;

  const width = 1000;
  const pad = 6;

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y =
      height - pad - ((point.gradePercent - lo) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const d = coords
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  const ink = level === "calm" ? "var(--ink)" : STATUS_VAR[level];
  const last = coords[coords.length - 1];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`Grade trace over ${points.length} checks, ${values[0].toFixed(1)}% to ${values[values.length - 1].toFixed(1)}%`}
      >
        {/* The field. Three rules, so the line has something to be measured against. */}
        {[0.5, 0.5, 0.5].map((_, index) => (
          <line
            key={index}
            x1={0}
            x2={width}
            y1={pad + (index * (height - pad * 2)) / 2}
            y2={pad + (index * (height - pad * 2)) / 2}
            stroke="var(--rule)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path
          ref={pathRef}
          d={d}
          fill="none"
          stroke={ink}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* The current reading, marked with a tick rather than a dot — with
            `preserveAspectRatio: none` a circle is drawn as a squashed ellipse,
            and a stray blob at the end of the line reads as a rendering fault. */}
        <line
          x1={last[0]}
          x2={last[0]}
          y1={last[1] - 5}
          y2={last[1] + 5}
          stroke={ink}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <figcaption className="mt-2 flex justify-between">
        <span className="docket text-[0.625rem]">
          {points[0].date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span className="docket text-[0.625rem]">
          {points[points.length - 1].date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })}
        </span>
      </figcaption>
    </figure>
  );
}
