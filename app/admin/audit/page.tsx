import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { RevertButton } from "@/components/admin/revert-button";

function summarize(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  if (!before) return "row created";
  const keys = Object.keys(a).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
  if (keys.length === 0) return "no field changes";
  return keys
    .slice(0, 4)
    .map((k) => `${k}: ${fmt(b[k])} → ${fmt(a[k])}`)
    .join(", ");
}

function fmt(v: unknown): string {
  if (v == null) return "—";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

export default async function AuditLogPage() {
  const rows = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(100);

  return (
    <main className="mt-8">
      <h1
        className="text-3xl text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Audit log
      </h1>
      <p className="mt-2 text-text-muted">
        Every applied change, newest first. Revert restores the prior state (PRD
        §5.1.7).
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-elevated text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Table</th>
              <th className="px-3 py-2 font-medium">Change</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="text-text-primary">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  No changes recorded yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2 text-text-muted">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-text-muted">{r.tableName}</td>
                <td className="px-3 py-2">
                  <div>{summarize(r.beforeJsonb, r.afterJsonb)}</div>
                  {r.reason && (
                    <div className="mt-0.5 text-xs text-text-muted">{r.reason}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-text-muted">{r.actor}</td>
                <td className="px-3 py-2">
                  <RevertButton auditId={r.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
