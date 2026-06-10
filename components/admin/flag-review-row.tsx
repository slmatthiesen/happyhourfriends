"use client";

import { useState, useTransition } from "react";
import { hideWindowAction, keepFlagAction, type ActionResult } from "@/app/admin/actions";
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
      if (r.ok) setDone(true);
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
        <button
          onClick={keep}
          disabled={pending || done}
          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
          title="The data is correct — resolve all of this venue's flags"
        >
          {pending ? "…" : "Keep (data is correct)"}
        </button>
      </div>

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
                  disabled={pending || done}
                  className="rounded-md border border-border px-2 py-0.5 hover:bg-row-hover disabled:opacity-50"
                  title="This window is wrong — hide it (reversible from /admin/audit)"
                >
                  Hide
                </button>
                <span className="text-text-primary">{windowLabel(w)}</span>
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
