"use client";

import { useEffect, useRef } from "react";

/**
 * Tally (MOTION.md).
 *
 * Figures arrive by counting to their value, not by sliding into place. This is
 * an almanac: the number is the content, and watching it settle is what makes a
 * page of statistics feel like a reading being taken rather than a layout being
 * populated.
 *
 * Tabular figures are set in CSS, so the element never changes width mid-count —
 * a tally that reflows the line it sits on looks broken, not precise.
 */
export function Tally({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const settled = useRef(false);

  const final = `${prefix}${to.toFixed(decimals)}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || settled.current) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let observer: IntersectionObserver | null = null;

    const run = () => {
      settled.current = true;
      const started = performance.now();
      // Big numbers earn a longer count; a "3" tallying for a second is comic.
      const duration = Math.min(1100, 380 + Math.log10(Math.abs(to) + 1) * 260);

      const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        // The house curve: hard deceleration into a dead stop, no overshoot.
        const eased = 1 - Math.pow(1 - t, 4);
        el.textContent = `${prefix}${(to * eased).toFixed(decimals)}${suffix}`;
        if (t < 1) frame = requestAnimationFrame(step);
        else el.textContent = final;
      };

      frame = requestAnimationFrame(step);
    };

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          run();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(el);

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, decimals, prefix, suffix, final]);

  // Rendered at its final value, so the figure is correct with no JS at all.
  return (
    <span ref={ref} className={`fig ${className}`}>
      {final}
    </span>
  );
}
