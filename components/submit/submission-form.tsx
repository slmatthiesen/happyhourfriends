"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SubmissionPayload, SubmissionTargetType } from "@/lib/submit/payload";
import { HCaptcha } from "./hcaptcha";

export interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "url" | "time" | "select" | "price" | "number" | "textarea";
  current?: string | number | null;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
}

/** A stable anonymous id kept in localStorage (PRD §1.1 — no accounts). A real
 *  device fingerprint can replace this later without schema change. */
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

function toInputValue(spec: FieldSpec): string {
  if (spec.current == null) return "";
  if (spec.type === "price" && typeof spec.current === "number") {
    return (spec.current / 100).toFixed(2);
  }
  return String(spec.current);
}

function parseField(spec: FieldSpec, raw: string): unknown {
  if (raw === "") return spec.type === "price" || spec.type === "number" ? null : "";
  if (spec.type === "price") {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : Math.round(n * 100);
  }
  if (spec.type === "number") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  }
  return raw;
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent-cool focus:outline-none";

export function SubmissionForm({
  targetType,
  targetId = null,
  fields,
  fixedAfter = {},
  summary,
  requireSource = false,
  critical = false,
  newRecord = false,
  reportMode = false,
  submitLabel = "Submit for review",
}: {
  targetType: SubmissionTargetType;
  targetId?: string | null;
  fields: FieldSpec[];
  fixedAfter?: Record<string, unknown>;
  summary?: string;
  requireSource?: boolean;
  critical?: boolean;
  /** new_venue: send every non-empty field, before=null. */
  newRecord?: boolean;
  /**
   * Free-text + photo report — no specific field edit. The note carries the message
   * ("whole menu's wrong, here's the current one") and the photo is the evidence;
   * a human/AI reconciles it. Requires a note or a photo.
   */
  reportMode?: boolean;
  submitLabel?: string;
}) {
  const initial = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.key, toInputValue(f)])),
    [fields],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">(
    "idle",
  );
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const after: Record<string, unknown> = { ...fixedAfter };
    const before: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (values[f.key] ?? "").trim();
      const cur = toInputValue(f).trim();
      const changed = newRecord ? raw !== "" : raw !== cur;
      if (changed) {
        after[f.key] = parseField(f, raw);
        if (!newRecord) before[f.key] = f.current ?? null;
      }
    }

    if (reportMode && reason.trim()) {
      after.note = reason.trim();
    }

    if (
      !reportMode &&
      Object.keys(after).length === Object.keys(fixedAfter).length
    ) {
      setError("Nothing changed yet — edit a field before submitting.");
      return;
    }
    if (reportMode && reason.trim().length < 10 && !imageDataUrl) {
      setError("Add a short note or a photo so we know what to update.");
      return;
    }
    if (requireSource && !sourceUrl.trim() && !imageDataUrl) {
      setError("Add a source — paste a link or snap a photo of the menu.");
      return;
    }
    if (critical && reason.trim().length < 15) {
      setError("Please explain this major change (at least 15 characters).");
      return;
    }

    const payload: SubmissionPayload = {
      targetType,
      targetId,
      diff: {
        before: newRecord ? null : before,
        after,
        sourceUrl: sourceUrl.trim() || null,
        summary: reason.trim() || summary,
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

  if (state === "done") {
    return (
      <div className="rounded-lg border border-border bg-bg-surface p-4 text-sm">
        <p className="text-text-primary">
          Thanks! Our AI will review and most changes apply within 24 hours.
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
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {critical && (
        <p className="rounded-md border border-accent-hot/40 bg-accent-hot/10 px-3 py-2 text-accent-hot">
          This is a major change. We&apos;ll corroborate it before applying, and the
          row will be flagged for community input.
        </p>
      )}

      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1 flex items-baseline justify-between text-text-muted">
            <span>{f.label}</span>
            {!newRecord && f.current != null && f.current !== "" && (
              <span className="text-xs">now: {toInputValue(f) || "—"}</span>
            )}
          </label>
          {f.type === "select" ? (
            <select
              className={inputCls}
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            >
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              className={inputCls}
              rows={2}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          ) : (
            <input
              className={inputCls}
              type={
                f.type === "time"
                  ? "time"
                  : f.type === "price" || f.type === "number"
                    ? "number"
                    : f.type === "url"
                      ? "url"
                      : "text"
              }
              step={f.type === "price" ? "0.01" : undefined}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          )}
          {f.help && <p className="mt-1 text-xs text-text-muted">{f.help}</p>}
        </div>
      ))}

      {(critical || reportMode) && (
        <div>
          <label className="mb-1 block text-text-muted">
            {critical
              ? "Why are you reporting this? (required)"
              : "What's out of date? (a note or a photo helps)"}
          </label>
          <textarea
            className={inputCls}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              critical
                ? "What changed, and how do you know?"
                : "e.g. The whole happy-hour menu changed this week — current one attached."
            }
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-text-muted">
          Source {requireSource ? "(add a link or a photo)" : "(optional)"}
        </label>
        <input
          className={inputCls}
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
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
          No link needed — a photo or PDF of the menu works too. Our AI reads it to confirm.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-text-muted">Your email (optional)</label>
        <input
          className={inputCls}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="If you want us to email you about issues"
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
        {state === "submitting" ? "Submitting…" : submitLabel}
      </button>
    </form>
  );
}
