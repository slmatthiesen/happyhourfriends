"use client";

import { useMemo, useState, useTransition } from "react";
import {
  reviewWindowBulkAction,
  type ReviewActionResult,
  type ReviewDecision,
} from "@/app/admin/actions";
import type { ReviewWindowEntry, SiblingWindow } from "@/lib/recover/reviewQueues";
import { formatDays } from "@/lib/format";

type QueueKind = "meal" | "hidden";

const QUEUE_DECISIONS: Record<QueueKind, Array<{ decision: ReviewDecision; label: string; confirm?: string }>> = {
  meal: [
    { decision: "keep", label: "Keep" },
    { decision: "hide", label: "Hide" },
    { decision: "delete", label: "Delete", confirm: "Permanently delete — a re-extraction can NEVER bring it back. Continue?" },
  ],
  hidden: [
    { decision: "keep", label: "Keep hidden" },
    { decision: "promote", label: "Promote", confirm: "Goes LIVE on the site immediately. Only promote after verifying the happy hour yourself. Continue?" },
    { decision: "delete", label: "Delete", confirm: "Permanently delete — a re-extraction can NEVER bring it back. Continue?" },
  ],
};

function timeLabel(e: ReviewWindowEntry): string {
  return e.allDay ? "all day" : `${e.startTime?.slice(0, 5) ?? "open"}–${e.endTime?.slice(0, 5) ?? "close"}`;
}

function offeringsLabel(e: ReviewWindowEntry): string {
  return e.offerings
    .slice(0, 4)
    .map((o) => `${o.name ?? o.description ?? "?"}${o.priceCents != null ? ` $${(o.priceCents / 100).toFixed(o.priceCents % 100 === 0 ? 0 : 2)}` : ""}`)
    .join(" · ");
}

function siblingLabel(s: SiblingWindow): string {
  const time = s.allDay ? "all day" : `${s.startTime?.slice(0, 5) ?? "open"}–${s.endTime?.slice(0, 5) ?? "close"}`;
  const items = `${s.offeringCount} item${s.offeringCount === 1 ? "" : "s"}`;
  return `${formatDays(s.daysOfWeek)} ${time} · ${items}${s.newer ? " · newer" : ""}`;
}

/**
 * "What survives if I delete this" — so removing a row never feels like erasing the venue.
 * reviewedActive: the row's own window is live (meal tab) vs hidden (hidden tab).
 */
function SiblingContext({ e, reviewedActive }: { e: ReviewWindowEntry; reviewedActive: boolean }) {
  const live = e.siblingWindows.filter((s) => s.active);
  const hidden = e.siblingWindows.filter((s) => !s.active);
  if (reviewedActive && live.length === 0) {
    return (
      <div className="mt-1 text-xs font-medium text-red-700">
        ⚠ only live window — deleting returns this venue to a stub
      </div>
    );
  }
  if (live.length > 0) {
    const best = live[0];
    return (
      <div className="mt-1 text-xs text-emerald-700">
        ✓ venue keeps {live.length} other live window{live.length === 1 ? "" : "s"}:{" "}
        <span className="text-text-muted">
          {siblingLabel(best)}
          {best.topOfferings.length > 0 ? ` (${best.topOfferings.join(", ")})` : ""}
        </span>
      </div>
    );
  }
  if (hidden.length > 0) {
    return (
      <div className="mt-1 text-xs text-text-muted">
        venue has {hidden.length} other hidden window{hidden.length === 1 ? "" : "s"}
      </div>
    );
  }
  return null;
}

export function ReviewQueues({ meal, hidden }: { meal: ReviewWindowEntry[]; hidden: ReviewWindowEntry[] }) {
  const [tab, setTab] = useState<QueueKind>("meal");
  // Rows already acted on this page-load (removed optimistically, no refetch needed).
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cityFilter, setCityFilter] = useState("all");
  const [evidenceOnly, setEvidenceOnly] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const all = tab === "meal" ? meal : hidden;
  const cities = useMemo(() => [...new Set(all.map((e) => e.city))].sort(), [all]);
  const rows = all.filter(
    (e) =>
      !doneIds.has(e.happyHourId) &&
      (cityFilter === "all" || e.city === cityFilter) &&
      (!evidenceOnly || e.evidence != null),
  );

  function switchTab(next: QueueKind) {
    setTab(next);
    setSelected(new Set());
    setCityFilter("all");
    setEvidenceOnly(false);
    setStatus(null);
  }

  function apply(ids: string[], decision: ReviewDecision, confirm?: string) {
    if (ids.length === 0) return;
    if (confirm && !window.confirm(`${ids.length} window(s): ${confirm}`)) return;
    setStatus(null);
    startTransition(async () => {
      const r: ReviewActionResult = await reviewWindowBulkAction(ids, decision, tab);
      if (r.ok) {
        setDoneIds((prev) => new Set([...prev, ...ids]));
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
      setStatus(r.ok ? `✓ ${r.summary}${r.warning ? ` — ⚠ ${r.warning}` : ""}` : `✗ ${r.error}`);
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected = rows.length > 0 && rows.every((e) => selected.has(e.happyHourId));
  const selectedVisible = rows.filter((e) => selected.has(e.happyHourId)).map((e) => e.happyHourId);

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 border-b border-border">
        {(["meal", "hidden"] as const).map((k) => (
          <button
            key={k}
            onClick={() => switchTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === k
                ? "border-accent-cool font-medium text-text-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {k === "meal" ? "Meal specials" : "Hidden windows"} (
            {(k === "meal" ? meal : hidden).filter((e) => !doneIds.has(e.happyHourId)).length})
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <select
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="rounded border border-border bg-transparent px-2 py-1"
        >
          <option value="all">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-text-muted">
          <input
            type="checkbox"
            checked={evidenceOnly}
            onChange={(e) => setEvidenceOnly(e.target.checked)}
          />
          evidence-backed only
        </label>
        <span className="text-text-muted">{rows.length} shown</span>
        {selectedVisible.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-text-muted">{selectedVisible.length} selected →</span>
            {QUEUE_DECISIONS[tab].map(({ decision, label, confirm }) => (
              <button
                key={decision}
                disabled={pending}
                onClick={() => apply(selectedVisible, decision, confirm)}
                className="rounded border border-border px-2 py-1 hover:bg-surface-raised disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </span>
        )}
      </div>

      {status && <p className="mt-3 text-sm text-text-muted">{status}</p>}

      <table className="mt-4 w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="w-8 py-2">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() =>
                  setSelected(
                    allVisibleSelected
                      ? new Set([...selected].filter((id) => !rows.some((e) => e.happyHourId === id)))
                      : new Set([...selected, ...rows.map((e) => e.happyHourId)]),
                  )
                }
              />
            </th>
            <th className="w-44 py-2">Venue</th>
            <th className="w-32 py-2">Window</th>
            <th className="py-2">Evidence / offerings</th>
            <th className="w-14 py-2 text-right">Avg $</th>
            <th className="w-52 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.happyHourId} className="border-b border-border/60 align-top">
              <td className="py-2">
                <input
                  type="checkbox"
                  checked={selected.has(e.happyHourId)}
                  onChange={() => toggleSelect(e.happyHourId)}
                />
              </td>
              <td className="py-2 pr-2">
                <a
                  href={e.websiteUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-text-primary hover:text-accent-cool"
                >
                  {e.venue}
                </a>
                <div className="text-xs text-text-muted">{e.city}</div>
              </td>
              <td className="py-2 pr-2">
                {formatDays(e.daysOfWeek)} {timeLabel(e)}
                {e.sourceUrl && (
                  <a
                    href={e.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-accent-cool hover:underline"
                  >
                    source
                  </a>
                )}
              </td>
              <td className="py-2 pr-2">
                {e.evidence ? (
                  <span className="font-medium text-amber-700">{e.evidence}</span>
                ) : (
                  <span className="text-text-muted">listed on price alone</span>
                )}
                <div className="text-xs text-text-muted">{offeringsLabel(e)}</div>
                {e.notes && <div className="text-xs italic text-text-muted">{e.notes.slice(0, 140)}</div>}
                {/* Invariant: meal-queue windows are always live (SQL: hh.active),
                    hidden-queue always hidden (NOT hh.active) — keep in sync if a tab is added. */}
                <SiblingContext e={e} reviewedActive={tab === "meal"} />
              </td>
              <td className="py-2 text-right tabular-nums">
                {e.avgPriceCents != null ? (e.avgPriceCents / 100).toFixed(2) : "—"}
              </td>
              <td className="py-2 text-right">
                {QUEUE_DECISIONS[tab].map(({ decision, label, confirm }) => (
                  <button
                    key={decision}
                    disabled={pending}
                    onClick={() => apply([e.happyHourId], decision, confirm)}
                    className={`ml-1.5 rounded border px-2 py-0.5 text-xs disabled:opacity-50 ${
                      decision === e.suggested ||
                      (decision === "keep" && (e.suggested === "keep" || e.suggested === "keep_hidden"))
                        ? "border-accent-cool font-medium text-accent-cool"
                        : "border-border text-text-muted hover:text-text-primary"
                    }`}
                    title={decision === e.suggested ? "Suggested" : undefined}
                  >
                    {label}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-text-muted">
                Queue clear 🎉
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
