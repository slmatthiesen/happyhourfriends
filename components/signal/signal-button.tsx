"use client";

import { useEffect, useRef, useState } from "react";

const COOLDOWN_MS = 1000;

/** Stable anonymous id from localStorage (mirrors flag-widget.tsx). */
function getFingerprint(): string {
  try {
    const key = "hhf_fp";
    let v = localStorage.getItem(key);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(key, v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Positive-only, toggleable "thumbs up" on a venue listing. Tap to add, tap again to
 * remove. Optimistic, then reconciles to the server-returned { count, tapped } so a
 * cleared-storage / second-device state self-corrects. Spam guard: disabled in-flight
 * + a ~1s cooldown; the API enforces the hard limit. Count shown only when >= 1.
 */
export function SignalButton({
  venueId,
  initialCount,
}: {
  venueId: string;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  const [tapped, setTapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const cooldownRef = useRef(false);

  // Read persisted tapped state after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    try {
      setTapped(localStorage.getItem(`hhf_signal_${venueId}`) === "1");
    } catch {
      /* ignore */
    }
  }, [venueId]);

  async function toggle() {
    if (busy || cooldownRef.current) return;
    const adding = !tapped;

    // Optimistic.
    setBusy(true);
    setTapped(adding);
    setCount((c) => c + (adding ? 1 : -1));

    try {
      const res = await fetch("/api/signals", {
        method: adding ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, fingerprint: getFingerprint(), website: "" }),
      });
      if (res.status === 429 || !res.ok) {
        // Revert; keep state untouched on the server.
        setTapped(!adding);
        setCount((c) => c + (adding ? -1 : 1));
      } else {
        const data = (await res.json()) as { count?: number; tapped?: boolean };
        const nextTapped = typeof data.tapped === "boolean" ? data.tapped : adding;
        if (typeof data.count === "number") setCount(data.count);
        setTapped(nextTapped);
        try {
          localStorage.setItem(`hhf_signal_${venueId}`, nextTapped ? "1" : "0");
        } catch {
          /* ignore */
        }
      }
    } catch {
      setTapped(!adding);
      setCount((c) => c + (adding ? -1 : 1));
    } finally {
      setBusy(false);
      cooldownRef.current = true;
      setTimeout(() => {
        cooldownRef.current = false;
      }, COOLDOWN_MS);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={tapped}
      aria-label={tapped ? "Remove your thumbs up" : "Give this listing a thumbs up"}
      title={tapped ? "You marked this a good one" : "Mark this a good one"}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition active:scale-95 disabled:opacity-60",
        tapped
          ? "border-accent-warm bg-accent-warm/15 text-accent-warm"
          : "border-border text-text-muted hover:border-accent-warm hover:text-accent-warm",
      ].join(" ")}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={tapped ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 10v12" />
        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
      </svg>
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}
