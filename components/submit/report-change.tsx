"use client";

import Link from "next/link";
import { useState } from "react";
import type { SubmissionPayload } from "@/lib/submit/payload";
import { normalizeUrl } from "@/lib/submit/normalizeUrl";
import { getFingerprint } from "./submission-form";
import { HCaptcha } from "./hcaptcha";

const inputCls =
  "w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent-cool focus:outline-none";

/**
 * The unified "report a change" form (operator decision 2026-05). Replaces the old
 * per-field edit / "menu out of date" / "report closed" affordances with ONE lazy
 * free-text box: the visitor describes what changed (+ optional photo/PDF/URL), and the
 * AI interpret stage maps it onto the venue's existing data. Nothing goes live until an
 * operator approves it. Posts a `targetType: "intent"` submission.
 */
export function ReportChange({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
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

    const trimmed = note.trim();
    if (trimmed.length < 10) {
      setError("Tell us what changed — a sentence or two is plenty.");
      return;
    }

    const normalizedUrl = normalizeUrl(sourceUrl);
    if (sourceUrl.trim() && !normalizedUrl) {
      setError("That link doesn't look right — include the full address, e.g. example.com");
      return;
    }

    const payload: SubmissionPayload = {
      targetType: "intent",
      targetId: venueId,
      diff: {
        before: null,
        after: { note: trimmed },
        sourceUrl: normalizedUrl,
        summary: trimmed.slice(0, 120),
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
          Thanks! Our AI reviews every report and a human approves changes before they go
          live — usually within 24 hours.
        </p>
        {statusUrl && (
          <Link
            href={statusUrl}
            className="mt-2 inline-block text-accent-cool hover:underline"
          >
            Check the status of your report →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md bg-accent-warm px-4 py-2 text-sm font-medium text-bg-deep transition-opacity hover:opacity-90"
      >
        {open ? "Cancel" : "Suggest a change"}
      </button>

      {open && (
        <form
          onSubmit={onSubmit}
          className="mt-3 space-y-4 rounded-lg border border-border bg-bg-surface p-4 text-sm"
        >
          <div>
            <label className="mb-1 block text-text-muted">
              What&apos;s different about {venueName}?
            </label>
            <textarea
              className={inputCls}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Tacos are $3 now, not $2 · They added $5 wings to happy hour · Happy hour runs til close now · This place closed"
            />
            <p className="mt-1 text-xs text-text-muted">
              Just describe it in plain words — we&apos;ll figure out the details.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-text-muted">
              Got a source? (optional, but it speeds things up)
            </label>
            <input
              className={inputCls}
              type="text"
              inputMode="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              onBlur={(e) => {
                const n = normalizeUrl(e.target.value);
                if (n) setSourceUrl(n);
              }}
              placeholder="Link — e.g. the venue's website or menu"
            />
            <div className="mt-2 flex items-center gap-3">
              <label className="cursor-pointer rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-primary hover:border-accent-cool">
                {imageDataUrl ? "Change file" : "📷 Photo or PDF of the menu"}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={onPickImage}
                />
              </label>
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
            <p className="mt-1 text-xs text-text-muted">
              A photo of the menu works great — our AI reads it to confirm.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-text-muted">Your email (optional)</label>
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

          <HCaptcha onToken={setToken} />

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
