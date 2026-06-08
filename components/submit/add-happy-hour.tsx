"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SubmissionPayload } from "@/lib/submit/payload";
import { normalizeUrl } from "@/lib/submit/normalizeUrl";
import { getFingerprint } from "./submission-form";
import { HCaptcha } from "./hcaptcha";

const inputCls =
  "w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent-cool focus:outline-none";

const DAYS: { label: string; value: number }[] = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 7 },
];

const KIND_OPTIONS = ["food", "drink", "other"] as const;
const CATEGORY_OPTIONS = [
  "beer",
  "wine",
  "cocktail",
  "spirit",
  "appetizer",
  "entree",
  "dessert",
  "other",
] as const;

type Kind = (typeof KIND_OPTIONS)[number];
type Category = (typeof CATEGORY_OPTIONS)[number];

interface OfferingDraft {
  name: string;
  kind: Kind;
  category: Category;
  /** Dollars as a string; we parse to integer cents on submit. */
  price: string;
}

function emptyOffering(): OfferingDraft {
  return { name: "", kind: "drink", category: "beer", price: "" };
}

function parseCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(/^\$/, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * AddHappyHour — the "we have no HH info yet, tell us about it" form. Mounted on a
 * stub-venue's detail page (and linked to from the table CTAs). The visitor can fill
 * in days/times/offerings, OR just attach a menu photo/URL and let the operator do
 * the structured entry. Either way, source (URL or photo) is required and the
 * submission goes straight to the admin queue — no AI interpret/verify runs.
 *
 * Auto-opens when the URL hash is `#add-happy-hour` so the CTAs that link in can
 * scroll right to it and reveal the form.
 */
export function AddHappyHour({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [offers, setOffers] = useState<OfferingDraft[]>([emptyOffering()]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-open when linked to from the table CTA. One-shot read of the URL hash on
  // mount — the eslint rule guards against cascading renders, which doesn't apply
  // to a single setState that flips an unrelated state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#add-happy-hour") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, []);

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  function updateOffer(i: number, patch: Partial<OfferingDraft>) {
    setOffers((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  function addOfferRow() {
    setOffers((prev) => [...prev, emptyOffering()]);
  }

  function removeOfferRow(i: number) {
    setOffers((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
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
      setFileDataUrl(typeof reader.result === "string" ? reader.result : null);
      setFileName(file.name);
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalizedUrl = normalizeUrl(sourceUrl);
    if (sourceUrl.trim() && !normalizedUrl) {
      setError("That link doesn't look right — include the full address, e.g. example.com");
      return;
    }
    const hasFile = !!fileDataUrl;
    if (!normalizedUrl && !hasFile) {
      setError("Add a source — paste the venue's menu/website link, or upload a photo of the menu.");
      return;
    }

    // Build the structured `after` blob. Sparse is fine — the operator can fill
    // in missing pieces from the photo on the admin side.
    const after: Record<string, unknown> = {};
    if (days.length > 0) after.daysOfWeek = days;
    if (startTime) after.startTime = startTime;
    if (endTime) after.endTime = endTime;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) after.notes = trimmedNotes;

    const cleanedOffers = offers
      .map((o) => {
        const cents = parseCents(o.price);
        const name = o.name.trim();
        if (!name && cents == null) return null;
        const row: Record<string, unknown> = { kind: o.kind, category: o.category };
        if (name) row.name = name;
        if (cents != null) row.priceCents = cents;
        return row;
      })
      .filter((x): x is Record<string, unknown> => x !== null);
    if (cleanedOffers.length > 0) after.offerings = cleanedOffers;

    const payload: SubmissionPayload = {
      targetType: "new_happy_hour",
      targetId: venueId,
      diff: {
        before: null,
        after,
        sourceUrl: normalizedUrl,
        summary: `Add first happy hour for ${venueName}`,
      },
      fingerprint: getFingerprint(),
      email: email.trim() || null,
      captchaToken: token,
      evidenceImage: fileDataUrl,
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
          Thanks! Our operator reviews every submission before it goes live — usually
          within 24 hours.
        </p>
        {statusUrl && (
          <Link
            href={statusUrl}
            className="mt-2 inline-block text-accent-cool hover:underline"
          >
            Check the status of your submission →
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
        {open ? "Cancel" : "Add a happy hour"}
      </button>

      {open && (
        <form
          onSubmit={onSubmit}
          className="mt-3 space-y-5 rounded-lg border border-border bg-bg-surface p-4 text-sm"
        >
          <p className="text-text-muted">
            Fill in what you know about {venueName}&apos;s happy hour — or just attach
            a menu photo and skip the rest. Everything except the source is optional;
            an operator will sort out the details before anything goes live.
          </p>

          <div>
            <label className="mb-2 block text-text-muted">Days it runs</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const on = days.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={
                      "rounded-md border px-3 py-1 text-xs transition-colors " +
                      (on
                        ? "border-accent-warm bg-accent-warm/20 text-text-primary"
                        : "border-border bg-bg-elevated text-text-muted hover:border-accent-cool")
                    }
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-text-muted">Start time</label>
              <input
                className={inputCls}
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-text-muted">
                End time <span className="text-text-muted">(leave blank for &quot;until close&quot;)</span>
              </label>
              <input
                className={inputCls}
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-text-muted">Notes (optional)</label>
            <input
              className={inputCls}
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. bar only · dine-in only · not on holidays"
            />
          </div>

          <div>
            <label className="mb-2 block text-text-muted">Deals (optional)</label>
            <div className="space-y-2">
              {offers.map((o, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input
                    className={inputCls + " col-span-5"}
                    type="text"
                    value={o.name}
                    onChange={(e) => updateOffer(i, { name: e.target.value })}
                    placeholder="e.g. Wells · Pints · Wings"
                  />
                  <select
                    className={inputCls + " col-span-2"}
                    value={o.kind}
                    onChange={(e) => updateOffer(i, { kind: e.target.value as Kind })}
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputCls + " col-span-2"}
                    value={o.category}
                    onChange={(e) =>
                      updateOffer(i, { category: e.target.value as Category })
                    }
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputCls + " col-span-2"}
                    type="text"
                    inputMode="decimal"
                    value={o.price}
                    onChange={(e) => updateOffer(i, { price: e.target.value })}
                    placeholder="$5"
                  />
                  <button
                    type="button"
                    onClick={() => removeOfferRow(i)}
                    disabled={offers.length === 1}
                    className="col-span-1 text-accent-hot hover:underline disabled:opacity-40"
                    aria-label="Remove this deal"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addOfferRow}
              className="mt-2 text-xs text-accent-cool hover:underline"
            >
              + Add another deal
            </button>
          </div>

          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <label className="mb-1 block text-text-primary">
              Source <span className="text-accent-hot">*</span>
            </label>
            <p className="mb-2 text-xs text-text-muted">
              We won&apos;t publish a happy hour without a source. A link OR a photo
              of the menu both work.
            </p>
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
              placeholder="venue's menu page, social post, etc."
            />
            <div className="mt-2 flex items-center gap-3">
              <label className="cursor-pointer rounded-md border border-border bg-bg-surface px-3 py-1.5 text-xs text-text-primary hover:border-accent-cool">
                {fileDataUrl ? "Change file" : "📷 Photo or PDF of the menu"}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={onPickFile}
                />
              </label>
              {fileDataUrl && (
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {fileDataUrl.startsWith("data:application/pdf") ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-bg-surface text-base">
                      📄
                    </span>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={fileDataUrl}
                      alt="Selected menu"
                      className="h-8 w-8 rounded object-cover"
                    />
                  )}
                  <span className="max-w-[10rem] truncate">{fileName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFileDataUrl(null);
                      setFileName(null);
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
            <label className="mb-1 block text-text-muted">Your email (optional)</label>
            <input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="If you want us to follow up"
            />
          </div>

          {/* Honeypot — hidden from humans (§5.1.3). */}
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
