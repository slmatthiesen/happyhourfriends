"use client";

import { useCallback, useState } from "react";
import { Turnstile } from "@/components/submit/turnstile";

export interface FlagWidgetProps {
  targetType: "venue" | "happy_hour";
  targetId: string;
  flagType?: string;
  confirmCount?: number;
  denyCount?: number;
  prompt?: string;
}

/** Stable anonymous id from localStorage (mirrors submission-form.tsx). */
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
 * Community flag / vote widget (PRD §5.2). Renders an inline banner asking
 * users to confirm or deny a reported issue; POSTs to /api/flags.
 */
export function FlagWidget({
  targetType,
  targetId,
  flagType = "discontinued",
  confirmCount,
  denyCount,
  prompt,
}: FlagWidgetProps) {
  const [token, setToken] = useState<string | null>(null);
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Stable callback ref so Turnstile's useEffect dep doesn't re-fire.
  const handleToken = useCallback((t: string | null) => setToken(t), []);

  const defaultPrompt =
    flagType === "discontinued"
      ? "Someone reported this happy hour has been discontinued. Can you confirm?"
      : flagType === "closed"
        ? "Someone reported this venue is permanently closed. Can you confirm?"
        : flagType === "price_increase"
          ? "Someone reported prices have increased at this happy hour. Can you confirm?"
          : flagType === "hours_changed"
            ? "Someone reported the hours for this happy hour have changed. Can you confirm?"
            : "Someone reported an issue with this listing. Can you confirm?";

  const displayPrompt = prompt ?? defaultPrompt;

  async function vote(voteValue: "confirm" | "deny") {
    setError(null);
    setState("submitting");
    try {
      const res = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          flagType,
          voteValue,
          fingerprint: getFingerprint(),
          captchaToken: token,
          website,
        }),
      });
      const data = (await res.json()) as { error?: string; duplicate?: boolean };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setError("Network error — please try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div
        role="status"
        className="rounded-lg border border-border bg-bg-surface px-4 py-3 text-sm text-text-muted"
      >
        Thanks for the heads-up! Your vote has been recorded.
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-accent-hot/40 bg-accent-hot/10 px-4 py-3 text-sm"
    >
      <p className="mb-3 font-medium text-accent-hot">⚠ {displayPrompt}</p>

      {(confirmCount != null || denyCount != null) && (
        <p className="mb-3 text-xs text-text-muted">
          {confirmCount ?? 0} confirmed · {denyCount ?? 0} denied
        </p>
      )}

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          disabled={state === "submitting"}
          onClick={() => void vote("confirm")}
          className="rounded-md border border-accent-hot bg-accent-hot px-3 py-1.5 font-medium text-bg-deep transition-opacity hover:opacity-90 disabled:opacity-50"
          aria-label="Confirm — yes, it is gone"
        >
          Yes, it&apos;s gone
        </button>
        <button
          type="button"
          disabled={state === "submitting"}
          onClick={() => void vote("deny")}
          className="rounded-md border border-border bg-bg-surface px-3 py-1.5 text-text-muted transition-opacity hover:opacity-90 disabled:opacity-50"
          aria-label="Deny — no, still happening"
        >
          No, still happening
        </button>
      </div>

      {/* Honeypot — hidden from humans, off the accessibility tree. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="hidden"
      />

      <Turnstile onToken={handleToken} />

      {error && (
        <p role="alert" className="mt-2 text-accent-hot">
          {error}
        </p>
      )}
    </div>
  );
}
