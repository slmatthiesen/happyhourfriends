/**
 * recompute:audit-flags — re-apply the CURRENT anomalyRules catalog to every already-audited
 * venue, using each row's stored `audit_input` snapshot. $0: no network, no AI, no re-fetch —
 * it only re-runs the pure rule function over data we already have.
 *
 * Use after a rule change (e.g. 2026-07-02: first-party homepage sources are now hard truth,
 * not a flag) to retire flags that the new ruleset no longer raises, without a paid re-audit.
 *
 * Machine-set rows (resolution scanned/clean/reported/fixed) get their flags rewritten and
 * resolution reset to clean (no flags) or scanned (some flags). Operator-adjudicated rows
 * (operator_kept/operator_hidden/further_review) are NEVER touched — a human verdict outranks
 * a rule re-scan, and its audit_input snapshot is the labeled example.
 *
 * SUBTRACTIVE by default: only rows where the new ruleset REMOVES flags are written, so a
 * rule-retirement never injects brand-new queue items. Rows where newer rules would ADD a
 * flag are reported but left alone (that's a forward re-audit — run audit:data for it); pass
 * --add-new to write those too.
 *
 * Usage: pnpm tsx scripts/recompute-audit-flags.ts [--apply] [--add-new]   (dry-run without --apply)
 */
import "dotenv/config";
import postgres from "postgres";
import { auditVenue, type VenueAuditInput, type AnomalyFlag } from "@/lib/audit/anomalyRules";

const APPLY = process.argv.includes("--apply");
const ADD_NEW = process.argv.includes("--add-new");
const OPERATOR_RESOLUTIONS = new Set(["operator_kept", "operator_hidden", "further_review"]);

function codes(flags: AnomalyFlag[]): string {
  return flags.map((f) => f.code).sort().join(",") || "∅";
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const rows = await sql<{ id: string; name: string; resolution: string; flags: AnomalyFlag[]; auditInput: VenueAuditInput }[]>`
      SELECT da.id, v.name, da.resolution, da.flags, da.audit_input AS "auditInput"
      FROM data_audit da
      JOIN venues v ON v.id = da.venue_id
      WHERE da.audit_input IS NOT NULL
        AND v.deleted_at IS NULL
      ORDER BY v.name`;

    let changed = 0;
    let skippedOperator = 0;
    const additive: string[] = [];
    for (const r of rows) {
      if (OPERATOR_RESOLUTIONS.has(r.resolution)) {
        skippedOperator++;
        continue;
      }
      const beforeSet = new Set((r.flags ?? []).map((f) => f.code));
      const next = auditVenue(r.auditInput);
      const before = codes(r.flags ?? []);
      const after = codes(next);
      if (before === after) continue;

      const addsNew = next.some((f) => !beforeSet.has(f.code));
      if (addsNew && !ADD_NEW) {
        additive.push(`  ${r.name}: [${before}] → [${after}]`);
        continue;
      }

      changed++;
      const resolution = next.length === 0 ? "clean" : "scanned";
      console.log(`  ${r.name}: [${before}] → [${after}]  (resolution → ${resolution})`);
      if (APPLY) {
        await sql`UPDATE data_audit SET flags = ${sql.json(next as never)}, resolution = ${resolution}, audited_at = now() WHERE id = ${r.id}`;
      }
    }

    console.log(
      `\n[${APPLY ? "APPLY" : "DRY RUN"}] ${rows.length} audited venue(s) · ${changed} flag-set change(s) · ${skippedOperator} operator-adjudicated row(s) left untouched.`,
    );
    if (additive.length > 0) {
      console.log(`\n${additive.length} row(s) where newer rules would ADD a flag — NOT applied (run audit:data, or pass --add-new):`);
      for (const line of additive) console.log(line);
    }
    if (!APPLY && changed > 0) console.log("\nRe-run with --apply to write.");
  } finally {
    await sql.end();
  }
}

main();
