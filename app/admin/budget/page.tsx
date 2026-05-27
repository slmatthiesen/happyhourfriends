import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiUsageLedger } from "@/db/schema";
import {
  capCents,
  firstOfCurrentMonth,
  monthSpendCents,
  tierFor,
  warningCents,
} from "@/lib/ai/budget";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const TIER_COPY: Record<string, string> = {
  normal: "Normal — Stage 2 runs for all risk levels.",
  critical_only: "Warning threshold passed — Stage 2 only on critical submissions.",
  stage1_only: "Cap reached — Stage 1 only; all Stage 2 calls queue to admin.",
};

export default async function BudgetPage() {
  const month = firstOfCurrentMonth();
  const [spent, rows] = await Promise.all([
    monthSpendCents(),
    db
      .select({
        stage: aiUsageLedger.stage,
        calls: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${aiUsageLedger.costCents}), 0)::int`,
        inTok: sql<number>`coalesce(sum(${aiUsageLedger.inputTokens}), 0)::int`,
        outTok: sql<number>`coalesce(sum(${aiUsageLedger.outputTokens}), 0)::int`,
      })
      .from(aiUsageLedger)
      .where(eq(aiUsageLedger.month, month))
      .groupBy(aiUsageLedger.stage),
  ]);

  const cap = capCents();
  const warn = warningCents();
  const tier = tierFor(spent);
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  const barColor =
    tier === "stage1_only"
      ? "var(--accent-hot)"
      : tier === "critical_only"
        ? "var(--accent-warm)"
        : "var(--accent-cool)";

  return (
    <main className="mt-8">
      <h1
        className="text-3xl text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        AI spend — {month.slice(0, 7)}
      </h1>

      <div className="mt-6 rounded-lg border border-border bg-bg-surface p-6">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl text-accent-warm">{money(spent)}</span>
          <span className="text-sm text-text-muted">
            of {money(cap)} cap · warn at {money(warn)}
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        <p className="mt-3 text-sm text-text-muted">{TIER_COPY[tier]}</p>
      </div>

      <h2 className="mt-8 text-sm font-medium text-text-muted">This month by stage</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="tabular-nums w-full text-left text-sm">
          <thead className="bg-bg-elevated text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Calls</th>
              <th className="px-3 py-2 font-medium">Input tok</th>
              <th className="px-3 py-2 font-medium">Output tok</th>
              <th className="px-3 py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="text-text-primary">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  No AI calls recorded this month.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.stage} className="border-t border-border">
                <td className="px-3 py-2">{r.stage}</td>
                <td className="px-3 py-2">{r.calls}</td>
                <td className="px-3 py-2">{r.inTok.toLocaleString()}</td>
                <td className="px-3 py-2">{r.outTok.toLocaleString()}</td>
                <td className="px-3 py-2 text-accent-warm">{money(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
