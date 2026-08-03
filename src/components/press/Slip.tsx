"use client";

import gsap from "gsap";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { SLIP_MS } from "./nav";

/**
 * Sheet Slip — the page turn (MOTION.md → Transitions).
 *
 * A sheet of the second stock slips up over the outgoing page, the route
 * changes underneath it, and it slips away off the top. It exists to cover the
 * seam: without it, a navigation is a white flash followed by a page whose
 * entrance animations have already half-played.
 *
 * Everything is delegated from the document rather than wired into each link, so
 * any `data-slip` anchor anywhere in the product gets the transition without
 * knowing this component exists. Modified clicks, external links and new tabs
 * are all left alone — a transition that swallows cmd-click is a bug, not a
 * flourish.
 */
export function Slip() {
  const router = useRouter();
  const pathname = usePathname();
  const sheet = useRef<HTMLDivElement>(null);
  const covering = useRef(false);

  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as HTMLElement | null)?.closest?.(
        "a[data-slip]",
      ) as HTMLAnchorElement | null;

      if (!anchor || anchor.target === "_blank") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#")) return;
      if (href === pathname) return;

      event.preventDefault();
      covering.current = true;

      gsap.to(el, {
        yPercent: 0,
        duration: SLIP_MS / 1000,
        ease: "power4.inOut",
        onComplete: () => router.push(href),
      });
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router, pathname]);

  // The new route has rendered underneath the sheet — take it away.
  useEffect(() => {
    const el = sheet.current;
    if (!el || !covering.current) return;

    covering.current = false;
    // Instant, explicitly: `scroll-behavior: smooth` is set globally for anchor
    // links, and it would otherwise animate this scroll underneath the sheet —
    // still running when the sheet lifts, so the new page slides on arrival.
    window.scrollTo({ top: 0, behavior: "instant" });

    gsap.to(el, {
      yPercent: -100,
      duration: SLIP_MS / 1000,
      ease: "power4.inOut",
      delay: 0.05,
      onComplete: () => gsap.set(el, { yPercent: 100 }),
    });
  }, [pathname]);

  return (
    <div ref={sheet} className="slip" aria-hidden="true">
      <div className="sheet flex h-full items-end pb-[var(--gutter)]">
        <span className="rubric">Gladiator</span>
      </div>
    </div>
  );
}
