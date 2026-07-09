"use client";

import Link from "next/link";
import { useState } from "react";
import type { SubmissionPayload } from "@/lib/submit/payload";
import { getFingerprint } from "./submission-form";
import { Turnstile } from "./turnstile";

/**
 * Dedicated "report permanently closed" control. Posts a venue status→closed submission
 * (targetType `venue`) — no link or photo required, since the visitor's report IS the
 * signal and there's no menu to verify. An explicit confirmation guards against an
 * accidental tap. It routes through classify → verify like any critical venue edit;
 * nothing is applied until an operator approves it.
 */
export function ReportClosed({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitClosed() {
    setError(null);
    const payload: SubmissionPayload = {
      targetType: "venue",
      targetId: venueId,
      diff: {
        before: null,
        after: { status: "closed" },
        summary: `Reported permanently closed: ${venueName}`.slice(0, 120),
      },
      fingerprint: getFingerprint(),
      email: email.trim() || null,
      captchaToken: token,
      website,
    };

    setState("submitting");
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; statusUrl?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setState("error");
        return;
      }
      setStatusUrl(data.statusUrl ?? null);
      setState("done");
    } catch {
      setError("Network error — please try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-lg border border-accent-hot/40 bg-accent-hot/5 p-3 text-sm">
        <p className="text-text-primary">
          Thanks — we&apos;ll verify that {venueName} has closed before removing it.
        </p>
        {statusUrl && (
          <Link
            href={statusUrl}
            className="mt-1 inline-block text-accent-cool hover:underline"
          >
            Track its status ↗
          </Link>
        )}
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-accent-hot/60 px-3 py-1.5 text-sm font-medium text-accent-hot transition-colors hover:bg-accent-hot/10"
      >
        🚫 Report as permanently closed
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-accent-hot/50 bg-accent-hot/5 p-4 text-sm">
      <p className="font-medium text-text-primary">
        Confirm: is {venueName} permanently closed?
      </p>
      <p className="mt-1 text-xs text-text-muted">
        A human verifies this before we remove the listing — only report a place that has
        actually shut down for good.
      </p>

      <div className="mt-3">
        <label className="mb-1 block text-text-muted">Your email (optional)</label>
        <input
          className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent-cool focus:outline-none"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="If you want us to follow up"
        />
      </div>

      {/* Honeypot — hidden from humans, off the accessibility tree (§5.1.3). */}
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

      <div className="mt-3">
        <Turnstile onToken={setToken} />
      </div>

      {error && <p className="mt-2 text-accent-hot">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submitClosed}
          disabled={state === "submitting"}
          className="rounded-md bg-accent-hot px-4 py-2 font-medium text-bg-deep transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {state === "submitting" ? "Submitting…" : "Yes, it's closed"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-border px-4 py-2 text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
