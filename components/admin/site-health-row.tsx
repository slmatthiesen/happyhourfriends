"use client";

import { useState, useTransition } from "react";
import {
  updateVenueWebsiteAction,
  acceptSuggestedUrlAction,
  deleteStubVenueAction,
} from "@/app/admin/actions";

export interface SiteHealthVenue {
  id: string;
  name: string;
  cityName: string | null;
  state: string | null;
  websiteUrl: string | null;
  health: string | null;
  detail: string | null;
  suggestedUrl: string | null;
  checkedAt: string | null;
}

export function SiteHealthRow({ venue }: { venue: SiteHealthVenue }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState(venue.websiteUrl ?? "");
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [resolved, setResolved] = useState(false);

  function apply(fn: () => Promise<{ ok: boolean; error?: string; warning?: string }>, doneText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMsg({ kind: "err", text: res.error ?? "Failed" });
      else if (res.warning) setMsg({ kind: "warn", text: res.warning });
      else {
        setMsg({ kind: "ok", text: doneText });
        setResolved(true);
      }
    });
  }

  function save() {
    const trimmed = url.trim();
    apply(() => updateVenueWebsiteAction(venue.id, trimmed || null), trimmed ? "Saved + published" : "Cleared + published");
  }

  function accept() {
    apply(() => acceptSuggestedUrlAction(venue.id), "Accepted + published");
  }

  function remove() {
    if (
      !window.confirm(
        `Remove "${venue.name}"? Soft-deletes it from the live site (revertable from the audit log) and publishes the removal to prod.`,
      )
    )
      return;
    apply(() => deleteStubVenueAction(venue.id), "Removed + published");
  }

  return (
    <tr className={`border-t border-border align-top ${resolved ? "opacity-50" : ""}`}>
      <td className="px-3 py-2">
        <div className="text-text-primary">{venue.name}</div>
        <div className="text-xs text-text-muted">
          {venue.cityName ?? "—"}
          {venue.state ? `, ${venue.state.toUpperCase()}` : ""}
        </div>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="rounded bg-accent-hot/10 px-1 text-accent-hot">{venue.health ?? "?"}</span>
        {venue.detail && <div className="mt-0.5 text-text-muted">{venue.detail}</div>}
        {venue.websiteUrl && (
          <a
            href={venue.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block break-all text-accent-cool hover:underline"
          >
            {venue.websiteUrl} ↗
          </a>
        )}
      </td>
      <td className="px-3 py-2">
        {venue.suggestedUrl && (
          <div className="mb-2 text-xs">
            <span className="text-text-muted">Suggested: </span>
            <a
              href={venue.suggestedUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-accent-cool hover:underline"
            >
              {venue.suggestedUrl} ↗
            </a>
            <button
              type="button"
              onClick={accept}
              disabled={pending}
              className="ml-2 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-row-hover disabled:opacity-50"
              title="Use the suggested URL and publish to prod"
            >
              Accept
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://venue-website.com"
            className="w-64 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row-hover disabled:opacity-50"
            title="Save this URL (blank = clear) and publish to prod"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs text-accent-hot hover:bg-accent-hot/10 disabled:opacity-50"
            title="Soft-delete this venue and publish the removal to prod"
          >
            Remove
          </button>
        </div>
        {msg && (
          <div className="mt-1 text-xs">
            <span
              className={
                msg.kind === "err"
                  ? "text-accent-hot"
                  : msg.kind === "warn"
                    ? "text-accent-warm"
                    : "text-accent-cool"
              }
            >
              {msg.kind === "err" ? "✗ " : msg.kind === "warn" ? "⚠ " : "✓ "}
              {msg.text}
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}
