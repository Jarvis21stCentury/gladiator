"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Build today's schedule on demand.
 *
 * The plan is written by a cron job (`vercel.json`, 11:15 UTC). That is right
 * for a deployment and useless on a machine you run yourself: nothing triggers
 * it, so "Today's plan" and the "right now" panel stay permanently empty and the
 * headline feature of the product looks broken.
 *
 * It is also genuinely wanted on a deployment. A plan is written once in the
 * morning; if you then add three tasks, rate something as brutal or change your
 * routine, the schedule on screen no longer reflects any of it until tomorrow.
 * Re-planning is the obvious thing to reach for and there was no way to ask.
 *
 * Regenerating replaces today's plan rather than adding a second one, so this is
 * safe to press repeatedly — the one thing it costs is a model call, which is
 * why it says so.
 */
export function PlanGenerateButton({ hasPlan }: { hasPlan: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/cron/daily-plan", { method: "POST" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          body.error ??
            `Couldn't build the plan (HTTP ${response.status}).`,
        );
        return;
      }

      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const working = busy || isPending;

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={generate}
        disabled={working}
        className="control"
        // The primary action only when there is no plan at all. Once one exists,
        // rebuilding is a deliberate choice, not the obvious next step.
        data-active={hasPlan ? undefined : "true"}
      >
        {working
          ? "Building…"
          : hasPlan
            ? "Rebuild today's plan"
            : "Make today's plan"}
      </button>

      {error ? (
        <span className="text-[0.8125rem]" style={{ color: "var(--flare)" }}>
          {error}
        </span>
      ) : (
        <span className="text-[0.75rem] text-ink-soft">
          uses your routine, what&apos;s due, and how long things take you
        </span>
      )}
    </span>
  );
}
