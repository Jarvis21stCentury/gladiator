"use client";

import { useEffect } from "react";

/**
 * Marks the row you are currently in.
 *
 * Deliberately a behaviour-only component that renders nothing and reaches for
 * the DOM, rather than the schedule becoming a client component.
 *
 * The schedule is a server component whose rows contain `<form>`s posting server
 * actions — that is what lets you tick work off with no JavaScript at all.
 * Making it a client component to compute "now" would trade that away for a
 * highlight. So the rows are rendered on the server carrying their times in
 * data attributes, and this finds the live one and sets `data-current` on it.
 * With no JavaScript the schedule is complete and usable; it just does not
 * glow.
 *
 * "Now" cannot come from the server: it renders in UTC on a deployment and the
 * student is elsewhere.
 */
export function ScheduleNow() {
  useEffect(() => {
    const apply = () => {
      const now = Date.now();

      for (const row of document.querySelectorAll<HTMLElement>("[data-start]")) {
        const start = Number(row.dataset.start);
        const end = Number(row.dataset.end);
        const live = Number.isFinite(start) && now >= start && now < end;

        if (live) row.dataset.current = "true";
        else delete row.dataset.current;
      }
    };

    apply();
    const timer = setInterval(apply, 15_000);
    return () => clearInterval(timer);
  }, []);

  return null;
}
