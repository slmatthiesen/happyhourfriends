"use client";

import { useState, useTransition } from "react";
import { applyAction, rejectAction } from "@/app/admin/actions";

export interface QueueItem {
  id: string;
  targetType: string;
  targetId: string | null;
  diff: {
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    sourceUrl?: string | null;
    summary?: string;
  };
  aiRiskLevel: string | null;
  aiVerdict: string | null;
  /** Stage-1/Stage-2 reasoning — the AI's approve/don't-approve opinion. */
  aiReasoning?: string | null;
  status: string;
  submitterEmail: string | null;
  createdAt: string;
  targetName?: string | null;
}

const RISK_COLOR: Record<string, string> = {
  low: "text-text-muted",
  medium: "text-accent-cool",
  high: "text-accent-warm",
  critical: "text-accent-hot",
};

function display(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Coerce an edited string back to the type of the original proposed value. */
function coerce(original: unknown, raw: string): unknown {
  if (raw === "") return original == null ? null : typeof original === "number" ? null : "";
  if (typeof original === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? original : n;
  }
  if (typeof original === "boolean") return raw === "true";
  return raw;
}

export function SubmissionCard({ item }: { item: QueueItem }) {
  const keys = Object.keys(item.diff.after);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>(
    Object.fromEntries(keys.map((k) => [k, display(item.diff.after[k])])),
  );
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) setDone("done");
      else setError(res.error ?? "Action failed");
    });
  }

  function onApply() {
    let override: Record<string, unknown> | undefined;
    if (editing) {
      override = {};
      for (const k of keys) override[k] = coerce(item.diff.after[k], edits[k] ?? "");
    }
    run(() => applyAction(item.id, override));
  }

  if (done) {
    return (
      <div className="rounded-lg border border-border bg-bg-surface p-4 text-sm text-text-muted">
        {item.targetName ?? item.targetType} — actioned.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium text-text-primary">
            {item.targetName ?? item.targetType.replace(/_/g, " ")}
          </span>
          <span className="ml-2 text-xs text-text-muted">
            {item.targetType.replace(/_/g, " ")} ·{" "}
            {new Date(item.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {item.aiRiskLevel && (
            <span className={RISK_COLOR[item.aiRiskLevel] ?? "text-text-muted"}>
              {item.aiRiskLevel} risk
            </span>
          )}
          <span className="rounded-full border border-border px-2 py-0.5 text-text-muted">
            {item.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {item.diff.summary && (
        <p className="mt-2 text-sm text-text-muted">{item.diff.summary}</p>
      )}

      {item.aiReasoning && (
        <p className="mt-2 rounded-md border border-border/60 bg-bg-elevated px-3 py-2 text-xs text-text-muted">
          <span className="text-text-primary">AI:</span> {item.aiReasoning}
        </p>
      )}

      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-xs text-text-muted">
          <tr>
            <th className="py-1 font-medium">Field</th>
            <th className="py-1 font-medium">Current</th>
            <th className="py-1 font-medium">Proposed</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t border-border/50">
              <td className="py-1 pr-3 text-text-muted">{k}</td>
              <td className="py-1 pr-3 text-text-muted">
                {display(item.diff.before?.[k])}
              </td>
              <td className="py-1 text-text-primary">
                {editing ? (
                  <input
                    className="w-full rounded border border-border bg-bg-elevated px-2 py-1"
                    value={edits[k] ?? ""}
                    onChange={(e) =>
                      setEdits((s) => ({ ...s, [k]: e.target.value }))
                    }
                  />
                ) : (
                  display(item.diff.after[k])
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-muted">
        {item.diff.sourceUrl ? (
          <a
            href={item.diff.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-cool hover:underline"
          >
            Source ↗
          </a>
        ) : (
          <span className="text-accent-hot">no source provided</span>
        )}
        {item.submitterEmail && <span>· {item.submitterEmail}</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onApply}
          className="rounded-md bg-accent-warm px-3 py-1.5 text-sm font-medium text-bg-deep hover:opacity-90 disabled:opacity-50"
        >
          {editing ? "Apply with edits" : "Apply"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing((e) => !e)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-row-hover disabled:opacity-50"
        >
          {editing ? "Cancel edits" : "Edit"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => rejectAction(item.id))}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-accent-hot hover:bg-row-hover disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-accent-hot">{error}</p>}
    </div>
  );
}
