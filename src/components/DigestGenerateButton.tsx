"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface DigestGenerateButtonProps {
  /** `YYYY-MM-DD` to build. */
  date: string;
  /** Rewrite notes that already exist rather than only filling gaps. */
  force?: boolean;
  label: string;
}

export function DigestGenerateButton({
  date,
  force = false,
  label,
}: DigestGenerateButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);

    try {
      const params = new URLSearchParams({ date });
      if (force) params.set("force", "1");

      const response = await fetch(`/api/digest/generate?${params}`, {
        method: "POST",
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.error ?? "Digest failed.");
        return;
      }

      const failed = body.digest.classes.filter(
        (entry: { status: string }) => entry.status === "failed",
      );

      setMessage(
        failed.length > 0
          ? `Wrote ${body.digest.notesWritten} note(s); ${failed.length} class(es) failed.`
          : `Wrote ${body.digest.notesWritten} note(s).`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="control"
        data-active={force ? undefined : "true"}
      >
        {busy ? "Distilling…" : label}
      </button>
      {message ? (
        <span className="docket">{message}</span>
      ) : null}
    </span>
  );
}
