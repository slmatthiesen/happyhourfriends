"use client";

import Link from "next/link";
import { useState } from "react";
import type { SubmissionPayload } from "@/lib/submit/payload";
import { normalizeUrl } from "@/lib/submit/normalizeUrl";
import { getFingerprint } from "./submission-form";
import { Turnstile } from "./turnstile";

const inputCls =
  "w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent-cool focus:outline-none";

/**
 * Unified contribution box (operator decision 2026-06). Adapts copy based on
 * whether the venue already has happy-hour data. Always posts a `targetType:
 * "intent"` submission — the backend routes it through the interpreter which
 * fans out concrete edits for admin review. Nothing goes live until an operator
 * approves.
 */
export function Contribute({
  venueId,
  venueName,
  hasHappyHour,
}: {
  venueId: string;
  venueName: string;
  hasHappyHour: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setError("Please choose an image or PDF file.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError("That file is over 6 MB — please pick a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(typeof reader.result === "string" ? reader.result : null);
      setImageName(file.name);
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const noteTrimmed = note.trim();
    const normalizedUrl = normalizeUrl(sourceUrl);

    // A typed-but-unparseable link (e.g. a typo) shouldn't be silently dropped.
    if (sourceUrl.trim() && !normalizedUrl) {
      setError("That link doesn't look right — include the full address, e.g. example.com");
      return;
    }
    // Every contribution must be backed by evidence — a link or a photo/PDF of the
    // menu. A description alone isn't enough: if we don't already have this info, we
    // need a source to verify it against.
    if (!normalizedUrl && !imageDataUrl) {
      setError(
        "Add a link or a photo of the menu — we need a source to verify your update.",
      );
      return;
    }

    const payload: SubmissionPayload = {
      targetType: "intent",
      targetId: venueId,
      diff: {
        before: null,
        after: { note: noteTrimmed },
        sourceUrl: normalizedUrl,
        summary: (noteTrimmed || `Contribution for ${venueName}`).slice(0, 120),
      },
      fingerprint: getFingerprint(),
      email: email.trim() || null,
      captchaToken: token,
      evidenceImage: imageDataUrl,
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
      <div className="rounded-lg border border-border bg-bg-surface p-4 text-sm">
        <p className="text-text-primary">
          Thanks — your update is in the review queue.
        </p>
        {statusUrl && (
          <Link
            href={statusUrl}
            className="mt-2 inline-block text-accent-cool hover:underline"
          >
            Track its status ↗
          </Link>
        )}
      </div>
    );
  }

  const triggerLabel = hasHappyHour ? "Suggest a change" : "Add a happy hour";
  const heading = hasHappyHour
    ? "Something off? Tell us"
    : `Know ${venueName}'s happy hour? Add it`;
  // The has-HH page section already explains the flow right above the trigger —
  // repeating it inside the form read as noise (operator feedback 2026-06-11).
  const blurb = hasHappyHour
    ? null
    : "A human reviews everything before it goes live.";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md bg-accent-warm px-4 py-2 text-sm font-medium text-bg-deep transition-opacity hover:opacity-90"
      >
        {open ? "Cancel" : triggerLabel}
      </button>

      {open && (
        <form
          onSubmit={onSubmit}
          className="mt-3 space-y-4 rounded-lg border border-border bg-bg-surface p-4 text-sm"
        >
          <div>
            <p className="mb-1 font-medium text-text-primary">{heading}</p>
            {blurb && <p className="text-xs text-text-muted">{blurb}</p>}
          </div>

          <div>
            <label className="mb-1 block text-text-muted">
              {hasHappyHour
                ? `What's different about ${venueName}?`
                : `Tell us about ${venueName}'s happy hour`}
            </label>
            <textarea
              className={inputCls}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                hasHappyHour
                  ? "e.g. Tacos are $3 now, not $2"
                  : "e.g. Mon–Fri 3–6 PM, $4 drafts and $2 off cocktails"
              }
            />
            <p className="mt-1 text-xs text-text-muted">
              Just describe it in plain words — we&apos;ll figure out the
              details.
            </p>
          </div>

          <div className="rounded-md border border-border bg-bg-elevated/60 p-3">
            <label className="mb-2 block text-text-muted">
              Add a source <span className="text-accent-hot">*</span> — either one
              works
            </label>
            {/* Link and photo are PARALLEL options, not steps — an explicit "or"
                keeps it from reading as "do both". Mobile-first: photos come from
                phones, so the photo button leads (full-width, centered "or" below);
                sm+ flips to input | or | button on one row. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="order-1 flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs text-text-primary hover:border-accent-cool sm:order-3 sm:w-auto">
                {imageDataUrl ? "Change file" : "📷 Add a photo of the menu"}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={onPickImage}
                />
              </label>
              <span className="order-2 text-center text-xs uppercase text-text-muted">
                or
              </span>
              <input
                className={`${inputCls} order-3 sm:order-1 sm:min-w-[12rem] sm:flex-1`}
                type="text"
                inputMode="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                onBlur={(e) => {
                  const n = normalizeUrl(e.target.value);
                  if (n) setSourceUrl(n);
                }}
                placeholder="Paste a link/URL"
              />
            </div>
            <div className="mt-2 flex items-center gap-3 empty:hidden">
              {imageDataUrl && (
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {imageDataUrl.startsWith("data:application/pdf") ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-bg-elevated text-base">
                      📄
                    </span>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={imageDataUrl}
                      alt="Selected menu"
                      className="h-8 w-8 rounded object-cover"
                    />
                  )}
                  <span className="max-w-[10rem] truncate">{imageName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setImageDataUrl(null);
                      setImageName(null);
                    }}
                    className="text-accent-hot hover:underline"
                  >
                    remove
                  </button>
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-text-muted">
              Your email (optional)
            </label>
            <input
              className={inputCls}
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

          <Turnstile onToken={setToken} />

          {error && <p className="text-accent-hot">{error}</p>}

          <button
            type="submit"
            disabled={state === "submitting"}
            className="rounded-md bg-accent-warm px-4 py-2 font-medium text-bg-deep transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {state === "submitting" ? "Submitting…" : "Submit for review"}
          </button>
        </form>
      )}
    </div>
  );
}
