"use client";

import { useState, useTransition } from "react";
import {
  resolveStubAction,
  addOfferingsToWindowAction,
  type ResolveStubResult,
  type AddOfferingsActionResult,
} from "@/app/admin/actions";

export interface BareWindow {
  id: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  sourceUrl: string | null;
}

export interface BareVenue {
  id: string;
  name: string;
  type: string | null;
  cityName: string | null;
  websiteUrl: string | null;
  hhPageUrl: string | null;
  windows: BareWindow[];
}

const DAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function fmtDays(days: number[]): string {
  if (!days?.length) return "—";
  const s = [...days].sort((a, b) => a - b);
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1] + 1);
  if (contiguous && s.length > 2) return `${DAY_LABEL[s[0]]}–${DAY_LABEL[s[s.length - 1]]}`;
  return s.map((d) => DAY_LABEL[d]).join(",");
}
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);
function fmtTime(w: BareWindow): string {
  if (w.allDay) return "all day";
  return `${hm(w.startTime) ?? "?"}–${hm(w.endTime) ?? "close"}`;
}

const OFFERING_KINDS = ["food", "drink", "other"] as const;
const OFFERING_CATEGORIES = ["beer", "wine", "cocktail", "spirit", "appetizer", "entree", "dessert", "other"] as const;
type OfferingKind = (typeof OFFERING_KINDS)[number];
type OfferingCategory = (typeof OFFERING_CATEGORIES)[number];

interface OfferingDraft {
  kind: OfferingKind;
  category: OfferingCategory;
  name: string;
  priceStr: string; // dollars, blank = no price
}
const emptyOffering = (): OfferingDraft => ({ kind: "drink", category: "beer", name: "", priceStr: "" });

// ── Add-deals form for one bare window ───────────────────────────────────────────
function AddDealsForm({ venue, window: win }: { venue: BareVenue; window: BareWindow }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AddOfferingsActionResult | null>(null);
  const [rows, setRows] = useState<OfferingDraft[]>([emptyOffering()]);
  const [sourceUrl, setSourceUrl] = useState(win.sourceUrl ?? venue.hhPageUrl ?? venue.websiteUrl ?? "");

  const update = <K extends keyof OfferingDraft>(idx: number, key: K, value: OfferingDraft[K]) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));

  function submit() {
    setResult(null);
    if (!sourceUrl.trim()) {
      setResult({ ok: false, error: "Enter the source URL (where you read the deals)." });
      return;
    }
    const offerings = rows
      .filter((o) => o.name.trim())
      .map((o) => {
        const dollars = parseFloat(o.priceStr);
        const priceCents =
          o.priceStr.trim() !== "" && Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null;
        return { kind: o.kind, category: o.category, name: o.name.trim(), priceCents };
      });
    if (offerings.length === 0) {
      setResult({ ok: false, error: "Add at least one deal with a name." });
      return;
    }
    startTransition(async () => {
      setResult(await addOfferingsToWindowAction({ happyHourId: win.id, sourceUrl: sourceUrl.trim(), offerings }));
    });
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-bg-elevated p-3 text-xs">
      <label className="mb-2 flex items-center gap-1.5">
        <span className="text-text-muted">Source URL</span>
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="menu / image / page url"
          className="w-72 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-text-primary"
        />
      </label>
      <div className="space-y-1.5">
        {rows.map((row, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-1.5">
            <select value={row.kind} onChange={(e) => update(idx, "kind", e.target.value as OfferingKind)} className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-text-primary">
              {OFFERING_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={row.category} onChange={(e) => update(idx, "category", e.target.value as OfferingCategory)} className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-text-primary">
              {OFFERING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="text" placeholder="name" value={row.name} onChange={(e) => update(idx, "name", e.target.value)} className="w-36 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-text-primary" />
            <input type="number" placeholder="$ price" min="0" step="0.01" value={row.priceStr} onChange={(e) => update(idx, "priceStr", e.target.value)} className="w-20 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-text-primary" />
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))} className="text-text-muted hover:text-accent-hot" title="Remove">✕</button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, emptyOffering()])} className="mt-1 text-accent-cool hover:underline">+ add deal</button>
      </div>
      <button type="button" onClick={submit} disabled={pending} className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50">
        {pending ? "Saving…" : "Save deals (live)"}
      </button>
      {result && (
        <div className="mt-1.5 text-xs">
          {result.error ? <span className="text-accent-hot">✗ {result.error}</span> : (
            <span className="text-accent-cool">✓ {result.added} deal(s) added{result.warning ? ` · ${result.warning}` : ""}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── BareWindowRow ────────────────────────────────────────────────────────────────
export function BareWindowRow({ venue }: { venue: BareVenue }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResolveStubResult | null>(null);
  const [url, setUrl] = useState("");
  const [openForm, setOpenForm] = useState<string | null>(null); // happyHourId whose add-deals form is open

  function reExtract(withUrl?: string) {
    setResult(null);
    startTransition(async () => {
      setResult(await resolveStubAction(venue.id, withUrl));
    });
  }

  const siteUrl = venue.hhPageUrl ?? venue.websiteUrl;

  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2">
        <div className="text-text-primary">{venue.name}</div>
        <div className="text-xs text-text-muted">
          {venue.cityName ?? "—"}{venue.type ? ` · ${venue.type}` : ""}
        </div>
        {siteUrl && (
          <a href={siteUrl} target="_blank" rel="noreferrer" className="text-xs text-accent-cool hover:underline">
            {venue.hhPageUrl ? "HH page ↗" : "website ↗"}
          </a>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        <ul className="space-y-1">
          {venue.windows.map((w) => (
            <li key={w.id}>
              <span className="text-text-primary">{fmtDays(w.daysOfWeek)} {fmtTime(w)}</span>
              <button
                type="button"
                onClick={() => setOpenForm((cur) => (cur === w.id ? null : w.id))}
                className="ml-2 text-accent-cool hover:underline"
              >
                {openForm === w.id ? "close" : "add deals"}
              </button>
              {openForm === w.id && <AddDealsForm venue={venue} window={w} />}
            </li>
          ))}
        </ul>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => reExtract()}
            disabled={pending}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            title="Re-run the full discovery + extract pipeline (now reads image menus)"
          >
            {pending ? "Re-extracting…" : "Re-extract"}
          </button>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="paste menu / PDF / image URL"
            className="w-56 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs"
          />
          <button
            onClick={() => reExtract(url)}
            disabled={pending || !url.trim()}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            title="Extract from the URL you pasted"
          >
            Extract from URL
          </button>
        </div>
        {result && (
          <div className="mt-1 text-xs">
            {result.error ? (
              <span className="text-accent-hot">✗ {result.error}</span>
            ) : result.recovered ? (
              <span className="text-accent-cool">✓ {result.windowsLive} window(s) · {result.costCents}¢ — refresh to see deals</span>
            ) : (
              <span className="text-text-muted">no new deals found ({result.costCents}¢){result.summary ? ` — ${result.summary.slice(0, 100)}` : ""}</span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
