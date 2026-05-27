"use client";

import { useState, useTransition } from "react";
import { setPromotionAction } from "@/app/admin/actions";

const TIERS = ["none", "highlight", "pin", "banner"] as const;

export interface PromotionVenue {
  id: string;
  name: string;
  neighborhoodName: string | null;
  promotionTier: string;
  promotionStartsAt: string | null; // ISO date (yyyy-mm-dd) or null
  promotionEndsAt: string | null;
}

export function PromotionRow({ venue }: { venue: PromotionVenue }) {
  const [tier, setTier] = useState(venue.promotionTier);
  const [starts, setStarts] = useState(venue.promotionStartsAt ?? "");
  const [ends, setEnds] = useState(venue.promotionEndsAt ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <tr className="border-t border-border align-middle">
      <td className="px-3 py-2 text-text-primary">
        {venue.name}
        {venue.neighborhoodName && (
          <span className="ml-2 text-xs text-text-muted">
            {venue.neighborhoodName}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-sm"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={starts}
          onChange={(e) => setStarts(e.target.value)}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={ends}
          onChange={(e) => setEnds(e.target.value)}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const res = await setPromotionAction(
                venue.id,
                tier,
                starts || null,
                ends || null,
              );
              setMsg(res.ok ? "saved" : (res.error ?? "error"));
            })
          }
          className="rounded-md bg-accent-warm px-3 py-1.5 text-sm font-medium text-bg-deep hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && <span className="ml-2 text-xs text-text-muted">{msg}</span>}
      </td>
    </tr>
  );
}
