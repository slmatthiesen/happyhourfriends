"use client";

import { useState, useTransition } from "react";
import {
  furtherReviewAction,
  hideWindowAction,
  keepFlagAction,
  stubVenueAction,
  type ActionResult,
} from "@/app/admin/actions";
import type { AnomalyFlag } from "@/lib/audit/anomalyRules";
import { formatDays, formatPrice } from "@/lib/format";

export interface FlaggedOffering {
  kind: string;
  category: string;
  name: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  currencyCode: string | null;
  description: string | null;
  conditions: string | null;
}

export interface FlaggedWindow {
  id: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  sourceUrl: string | null;
  offerings: FlaggedOffering[];
}

export interface FlaggedVenue {
  venueId: string;
  name: string;
  cityName: string | null;
  websiteUrl: string | null;
  flags: AnomalyFlag[];
  windows: FlaggedWindow[];
  /** Operator note from the Further-review lane (data_audit.operator_note). */
  note: string | null;
  /** True when the venue is parked in the Further-review lane (resolution further_review). */
  parked: boolean;
}

function windowLabel(w: FlaggedWindow): string {
  const time = w.allDay ? "all day" : `${w.startTime?.slice(0, 5) ?? "open"}–${w.endTime?.slice(0, 5) ?? "close"}`;
  return `${formatDays(w.daysOfWeek)} ${time}`;
}

function offeringLabel(o: FlaggedOffering): string {
  const price = formatPrice(o.priceCents, o.currencyCode ?? "USD");
  const original = formatPrice(o.originalPriceCents, o.currencyCode ?? "USD");
  const parts = [
    [o.name ?? o.description ?? o.category, price && original ? `${price} (reg ${original})` : price]
      .filter(Boolean)
      .join(" — "),
    o.name && o.description ? o.description : null,
    o.conditions,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function FlagReviewRow({ venue }: { venue: FlaggedVenue }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [done, setDone] = useState(false);
  const [noteOpen, setNoteOpen] = useState(venue.parked);
  const [note, setNote] = useState(venue.note ?? "");
  const [noteSaved, setNoteSaved] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  function keep() {
    setResult(null);
    startTransition(async () => {
      const r = await keepFlagAction(venue.venueId);
      setResult(r);
      if (r.ok) setDone(true);
    });
  }

  function hide(happyHourId: string) {
    setResult(null);
    startTransition(async () => {
      const r = await hideWindowAction(happyHourId);
      setResult(r);
      if (r.ok) {
        // The row stays interactive so further windows can be hidden; the venue only
        // settles (and the row leaves) when its last window goes dark.
        const nowHidden = new Set(hiddenIds).add(happyHourId);
        setHiddenIds(nowHidden);
        if (nowHidden.size >= venue.windows.length) setDone(true);
      }
    });
  }

  function stubVenue() {
    setResult(null);
    startTransition(async () => {
      const r = await stubVenueAction(venue.venueId);
      setResult(r);
      if (r.ok) setDone(true);
    });
  }

  function saveNote() {
    setResult(null);
    setNoteSaved(false);
    startTransition(async () => {
      const r = await furtherReviewAction(venue.venueId, note);
      setResult(r);
      // A queue row leaves for the parked lane; a parked row stays put with its new note.
      if (r.ok && !venue.parked) setDone(true);
      if (r.ok && venue.parked) setNoteSaved(true);
    });
  }

  if (done && result?.ok && !result.warning) return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-text-primary">{venue.name}</div>
          <div className="text-xs text-text-muted">
            {venue.cityName ?? "—"}
            {venue.websiteUrl && (
              <>
                {" · "}
                <a href={venue.websiteUrl} target="_blank" rel="noreferrer" className="text-accent-cool hover:underline">
                  website ↗
                </a>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNoteOpen((o) => !o)}
            disabled={pending || done}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            title="Not sure yet — park this venue with a note for a deeper dive"
          >
            Further review…
          </button>
          <button
            onClick={keep}
            disabled={pending || done}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            title="The data is correct — resolve all of this venue's flags"
          >
            {pending ? "…" : "Keep (data is correct)"}
          </button>
          {venue.windows.length > 0 && (
            <button
              onClick={stubVenue}
              disabled={pending || done}
              className="rounded-md border border-accent-hot/50 px-2.5 py-1 text-xs text-accent-hot hover:bg-row-hover disabled:opacity-50"
              title="All of this venue's HH data is wrong — hide every window and demote to stub (each window reversible from /admin/audit)"
            >
              {pending ? "…" : `Stub venue (hide all ${venue.windows.length})`}
            </button>
          )}
        </div>
      </div>

      {noteOpen && (
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteSaved(false);
            }}
            rows={2}
            placeholder="Sourcing story: where did this come from, what did the pipeline get/miss and why?"
            className="w-full rounded-md border border-border bg-transparent p-2 text-xs text-text-primary placeholder:text-text-muted"
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={saveNote}
              disabled={pending || done || !note.trim()}
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            >
              {pending ? "…" : venue.parked ? "Update note" : "Park for further review"}
            </button>
            {noteSaved && <span className="text-xs text-text-muted">✓ saved</span>}
          </div>
        </div>
      )}

      <ul className="mt-2 space-y-0.5 text-xs">
        {venue.flags.map((f, i) => (
          <li key={i} className="text-text-muted">
            <code className={f.severity === "auto_fixable" ? "text-accent-hot" : "text-accent-cool"}>{f.code}</code>{" "}
            — {f.evidence}
          </li>
        ))}
      </ul>

      {venue.windows.length > 0 && (
        <div className="mt-3 space-y-1">
          {venue.windows.map((w) => (
            <div key={w.id} className="text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => hide(w.id)}
                  disabled={pending || done || hiddenIds.has(w.id)}
                  className="rounded-md border border-border px-2 py-0.5 hover:bg-row-hover disabled:opacity-50"
                  title="This window is wrong — hide it (reversible from /admin/audit)"
                >
                  {hiddenIds.has(w.id) ? "Hidden ✓" : "Hide"}
                </button>
                <span className={hiddenIds.has(w.id) ? "text-text-muted line-through" : "text-text-primary"}>
                  {windowLabel(w)}
                </span>
                {w.offerings.length === 0 && <span className="text-text-muted">· no offerings captured</span>}
                {w.sourceUrl && (
                  <a href={w.sourceUrl} target="_blank" rel="noreferrer" className="text-accent-cool hover:underline">
                    source ↗
                  </a>
                )}
              </div>
              {w.offerings.length > 0 && (
                <ul className="ml-14 mt-0.5 list-disc space-y-0.5 text-text-muted">
                  {w.offerings.map((o, i) => (
                    <li key={i}>
                      <span className="uppercase tracking-wide text-[10px] text-accent-cool">{o.kind}</span>{" "}
                      {offeringLabel(o)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {result && (result.error || result.warning) && (
        <div className="mt-2 text-xs">
          {result.error ? (
            <span className="text-accent-hot">✗ {result.error}</span>
          ) : (
            <span className="text-text-muted">⚠ {result.warning}</span>
          )}
        </div>
      )}
    </div>
  );
}
