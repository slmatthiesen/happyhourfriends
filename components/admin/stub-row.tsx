"use client";

import { useState, useTransition } from "react";
import { resolveStubAction, type ResolveStubResult } from "@/app/admin/actions";

export interface StubVenue {
  id: string;
  name: string;
  cityName: string | null;
  websiteUrl: string | null;
  candidateUrl: string | null;
  score: number | null;
  type: string | null;
}

export function StubRow({ venue }: { venue: StubVenue }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResolveStubResult | null>(null);
  const [url, setUrl] = useState("");

  function run(withUrl?: string) {
    setResult(null);
    startTransition(async () => {
      setResult(await resolveStubAction(venue.id, withUrl));
    });
  }

  const scorePct = venue.score != null ? `${Math.round(venue.score * 100)}%` : "—";

  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2">
        <div className="text-text-primary">{venue.name}</div>
        <div className="text-xs text-text-muted">
          {venue.cityName ?? "—"}
          {venue.type ? ` · ${venue.type}` : ""} · HH-likelihood {scorePct}
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
      </td>
    </tr>
  );
}
