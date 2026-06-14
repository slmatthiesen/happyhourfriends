"use client";

import { useState, useTransition } from "react";
import {
  resolveStubAction,
  createManualWindowAction,
  type ResolveStubResult,
  type ManualWindowActionResult,
} from "@/app/admin/actions";

export interface StubVenue {
  id: string;
  name: string;
  cityName: string | null;
  websiteUrl: string | null;
  candidateUrl: string | null;
  score: number | null;
  type: string | null;
  hhProbeStatus: string | null;
  hhPageUrl: string | null;
  address: string | null;
  phone: string | null;
}

// ── day labels for the manual-entry form (ISO 1=Mon … 7=Sun) ─────────────────────
const DAYS = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
] as const;

const OFFERING_KINDS = ["food", "drink", "other"] as const;
const OFFERING_CATEGORIES = [
  "beer",
  "wine",
  "cocktail",
  "spirit",
  "appetizer",
  "entree",
  "dessert",
  "other",
] as const;

type OfferingKind = (typeof OFFERING_KINDS)[number];
type OfferingCategory = (typeof OFFERING_CATEGORIES)[number];

interface OfferingDraft {
  kind: OfferingKind;
  category: OfferingCategory;
  name: string;
  priceStr: string; // dollars, blank = no price
}

function emptyOffering(): OfferingDraft {
  return { kind: "drink", category: "beer", name: "", priceStr: "" };
}

// ── Manual entry form (shown only for blocked venues) ────────────────────────────

function ManualEntryForm({ venue }: { venue: StubVenue }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ManualWindowActionResult | null>(null);
  const [checkedDays, setCheckedDays] = useState<Set<number>>(new Set());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [offeringRows, setOfferingRows] = useState<OfferingDraft[]>([emptyOffering()]);

  function toggleDay(iso: number) {
    setCheckedDays((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  function updateOffering<K extends keyof OfferingDraft>(
    idx: number,
    key: K,
    value: OfferingDraft[K],
  ) {
    setOfferingRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }

  function addOffering() {
    setOfferingRows((rows) => [...rows, emptyOffering()]);
  }

  function removeOffering(idx: number) {
    setOfferingRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function submit() {
    setResult(null);
    const sourceUrl = venue.hhPageUrl ?? venue.websiteUrl ?? "";
    const input = {
      venueId: venue.id,
      daysOfWeek: Array.from(checkedDays).sort((a, b) => a - b),
      startTime: startTime || null,
      endTime: endTime || null,
      sourceUrl,
      offerings: offeringRows
        .filter((o) => o.name.trim())
        .map((o) => ({
          kind: o.kind,
          category: o.category,
          name: o.name.trim(),
          priceCents:
            o.priceStr.trim() !== ""
              ? Math.round(parseFloat(o.priceStr) * 100)
              : null,
        })),
    };
    startTransition(async () => {
      setResult(await createManualWindowAction(input));
    });
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-bg-elevated p-3 text-xs">
      {/* Context: read-only venue info for the operator to reference */}
      <div className="mb-3 space-y-0.5 text-text-muted">
        <div className="font-medium text-text-primary">{venue.name}</div>
        {venue.address && <div>{venue.address}</div>}
        {venue.phone && <div>{venue.phone}</div>}
        {(venue.hhPageUrl ?? venue.websiteUrl) && (
          <a
            href={venue.hhPageUrl ?? venue.websiteUrl ?? ""}
            target="_blank"
            rel="noreferrer"
            className="text-accent-cool hover:underline"
          >
            {venue.hhPageUrl ? "HH page ↗" : "website ↗"}
          </a>
        )}
      </div>

      {/* Days */}
      <div className="mb-2">
        <div className="mb-1 font-medium text-text-primary">Days</div>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(({ iso, label }) => (
            <label key={iso} className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={checkedDays.has(iso)}
                onChange={() => toggleDay(iso)}
                className="accent-accent-cool"
              />
              <span className="text-text-primary">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Times */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-text-muted">Start</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-text-primary"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-text-muted">End</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-text-primary"
          />
          <span className="text-text-muted">(blank = until close)</span>
        </label>
      </div>

      {/* Offerings */}
      <div className="mb-2">
        <div className="mb-1 font-medium text-text-primary">Offerings</div>
        <div className="space-y-1.5">
          {offeringRows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-1.5">
              <select
                value={row.kind}
                onChange={(e) => updateOffering(idx, "kind", e.target.value as OfferingKind)}
                className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-text-primary"
              >
                {OFFERING_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <select
                value={row.category}
                onChange={(e) =>
                  updateOffering(idx, "category", e.target.value as OfferingCategory)
                }
                className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-text-primary"
              >
                {OFFERING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="name"
                value={row.name}
                onChange={(e) => updateOffering(idx, "name", e.target.value)}
                className="w-36 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-text-primary"
              />
              <input
                type="number"
                placeholder="$ price"
                min="0"
                step="0.01"
                value={row.priceStr}
                onChange={(e) => updateOffering(idx, "priceStr", e.target.value)}
                className="w-20 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-text-primary"
              />
              {offeringRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeOffering(idx)}
                  className="text-text-muted hover:text-accent-hot"
                  title="Remove row"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addOffering}
            className="mt-1 text-accent-cool hover:underline"
          >
            + add offering
          </button>
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
      >
        {pending ? "Saving…" : "Create window (live)"}
      </button>

      {result && (
        <div className="mt-1.5 text-xs">
          {result.error ? (
            <span className="text-accent-hot">✗ {result.error}</span>
          ) : (
            <span className="text-accent-cool">✓ {result.summary}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── StubRow ───────────────────────────────────────────────────────────────────────

export function StubRow({ venue }: { venue: StubVenue }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResolveStubResult | null>(null);
  const [url, setUrl] = useState("");
  const [showManual, setShowManual] = useState(false);

  function run(withUrl?: string) {
    setResult(null);
    startTransition(async () => {
      setResult(await resolveStubAction(venue.id, withUrl));
    });
  }

  const scorePct = venue.score != null ? `${Math.round(venue.score * 100)}%` : "—";
  const isBlocked = venue.hhProbeStatus === "blocked";

  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2">
        <div className="text-text-primary">{venue.name}</div>
        <div className="text-xs text-text-muted">
          {venue.cityName ?? "—"}
          {venue.type ? ` · ${venue.type}` : ""} · HH-likelihood {scorePct}
          {isBlocked && (
            <span className="ml-1 rounded bg-accent-hot/10 px-1 text-accent-hot">
              site unreadable
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-xs">
        {venue.websiteUrl ? (
          <a href={venue.websiteUrl} target="_blank" rel="noreferrer" className="text-accent-cool hover:underline">
            website ↗
          </a>
        ) : (
          <span className="text-text-muted">no website</span>
        )}
        {venue.candidateUrl && venue.candidateUrl !== venue.websiteUrl && (
          <>
            {" · "}
            <a href={venue.candidateUrl} target="_blank" rel="noreferrer" className="text-accent-cool hover:underline">
              candidate ↗
            </a>
          </>
        )}
        {venue.hhPageUrl && venue.hhPageUrl !== venue.websiteUrl && (
          <>
            {" · "}
            <a href={venue.hhPageUrl} target="_blank" rel="noreferrer" className="text-accent-cool hover:underline">
              HH page ↗
            </a>
          </>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => run()}
            disabled={pending}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            title="Run the full discovery + extract pipeline on this venue"
          >
            {pending ? "Resolving…" : "Auto-retry"}
          </button>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="paste menu / PDF / image URL"
            className="w-56 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs"
          />
          <button
            onClick={() => run(url)}
            disabled={pending || !url.trim()}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            title="Extract from the URL you pasted"
          >
            Resolve with URL
          </button>
          {isBlocked && (
            <button
              onClick={() => setShowManual((v) => !v)}
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover"
              title="Enter happy-hour details by hand (site is confirmed unreadable)"
            >
              {showManual ? "Hide manual form" : "Enter manually"}
            </button>
          )}
        </div>
        {result && (
          <div className="mt-1 text-xs">
            {result.error ? (
              <span className="text-accent-hot">✗ {result.error}</span>
            ) : result.recovered ? (
              <span className="text-accent-cool">
                ✓ live — {result.windowsLive} window(s)
                {result.windowsHidden ? ` (+${result.windowsHidden} hidden)` : ""} · {result.costCents}¢
              </span>
            ) : (
              <span className="text-text-muted">
                no window found ({result.costCents}¢){result.summary ? ` — ${result.summary.slice(0, 120)}` : ""}
              </span>
            )}
          </div>
        )}
        {isBlocked && showManual && <ManualEntryForm venue={venue} />}
      </td>
    </tr>
  );
}
