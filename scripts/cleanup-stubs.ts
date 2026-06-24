/**
 * cleanup-stubs — unified stub curation pass (keep / hide / delete).
 *
 * Classifies every no-HH active venue (lib/places/stubCleanup) and, with --apply, hides the
 * HIDE bucket (status='no_happy_hour', reversible) and soft-deletes the DELETE bucket
 * (deleted_at, google_place_id kept as re-discovery guard). Both audit-logged. Dry-run by
 * default: prints per-city keep/hide/delete counts under BOTH policies side by side so the
 * alcohol-only delta over the default alcohol-or-site is visible without a second run.
 *
 *   Dry-run (default, no writes), all cities, default policy:
 *     pnpm cleanup:stubs
 *   Scope + verbose listing:
 *     pnpm cleanup:stubs --city san-jose --state CA --verbose
 *   Refresh site_health first (for the dead-site delete test), then apply the tighter policy:
 *     pnpm cleanup:stubs --refresh-sites --policy alcohol-only --apply
 *
 * Requires DATABASE_URL only. Idempotent + re-runnable. All-cities when --city is omitted.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import {
  classifyStub,
  type StubAction,
  type StubCleanupPolicy,
} from "@/lib/places/stubCleanup";

interface Row {
  id: string;
  name: string;
  city: string;
  primary_type: string | null;
  types: string[] | null;
  website_url: string | null;
  site_health: string | null;
  reviews: number | null;
}

const POLICIES: StubCleanupPolicy[] = ["alcohol-or-site", "alcohol-only"];

function parsePolicy(args: string[]): StubCleanupPolicy {
  const i = args.indexOf("--policy");
  if (i === -1) return "alcohol-or-site";
  const v = args[i + 1];
  if (v !== "alcohol-or-site" && v !== "alcohol-only") {
    console.error(`ERROR: --policy must be 'alcohol-or-site' or 'alcohol-only' (got ${v ?? "nothing"}).`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const verbose = args.includes("--verbose");
  const refreshSites = args.includes("--refresh-sites");
  const policy = parsePolicy(args);
  const cityArgs = args.includes("--city") ? requireCityArgs() : null;

  // Refresh site_health first so the dead-site delete test is current. Reuses the existing probe.
  if (refreshSites) {
    // execFileSync (no shell) so city/state args can't be interpolated into a shell string.
    const scopeArgs = cityArgs ? ["--city", cityArgs.slug, "--state", cityArgs.state] : [];
    console.log("Refreshing site_health via audit:venue-sites --persist …");
    execFileSync("pnpm", ["audit:venue-sites", "--persist", ...scopeArgs], { stdio: "inherit" });
  }

  const sql = postgres(dbUrl, { max: 1 });
  try {
    // Active, non-deleted venues with NO live happy hour, joined to their discovery candidate for
    // the alcohol/cuisine signal. A venue with no candidate has null signals → hasAlcoholSignal
    // false and no zero-HH type; with a website it routes by policy, without one it deletes.
    const rows = await sql<Row[]>`
      SELECT v.id, v.name, c.slug AS city,
             sc.primary_type, sc.types, sc.user_rating_count AS reviews,
             v.website_url, v.site_health
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      LEFT JOIN seed_candidates sc ON sc.google_place_id = v.google_place_id
      WHERE v.deleted_at IS NULL AND v.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h
          WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND lower(c.slug) = ${cityArgs.slug} AND lower(c.state) = ${cityArgs.state}` : sql``}
      ORDER BY c.slug, v.name
    `;

    const toSignal = (v: Row) => ({
      name: v.name, primaryType: v.primary_type, types: v.types,
      websiteUrl: v.website_url, siteHealth: v.site_health,
    });

    // Report: tally every venue under BOTH policies so the operator sees the alcohol-only delta.
    type Counts = Record<StubAction, number>;
    const perCity = new Map<string, Record<StubCleanupPolicy, Counts>>();
    const blank = (): Counts => ({ keep: 0, hide: 0, delete: 0 });
    for (const v of rows) {
      const bucket = perCity.get(v.city) ?? { "alcohol-or-site": blank(), "alcohol-only": blank() };
      for (const p of POLICIES) bucket[p][classifyStub(toSignal(v), p).action]++;
      perCity.set(v.city, bucket);
    }

    const scope = cityArgs ? `${cityArgs.slug}, ${cityArgs.state}` : "all cities";
    console.log(`\nStub cleanup — ${rows.length} HH-less active venue(s) in ${scope}.`);
    console.log(`Applying policy: ${policy}${apply ? "" : "  (dry-run)"}\n`);
    console.log("  city".padEnd(24) + "  alcohol-or-site (keep/hide/del)   alcohol-only (keep/hide/del)");
    const fmt = (c: Counts) => `${c.keep}/${c.hide}/${c.delete}`.padEnd(16);
    for (const [city, b] of [...perCity.entries()].sort()) {
      console.log("  " + city.padEnd(22) + "  " + fmt(b["alcohol-or-site"]) + "                  " + fmt(b["alcohol-only"]));
    }

    // Classify under the SELECTED policy for the actual action sets.
    const verdicts = rows.map((v) => ({ row: v, verdict: classifyStub(toSignal(v), policy) }));
    const hideIds = verdicts.filter((x) => x.verdict.action === "hide").map((x) => x.row.id);
    const deleteRows = verdicts.filter((x) => x.verdict.action === "delete");
    const keepN = verdicts.filter((x) => x.verdict.action === "keep").length;
    console.log(`\nUnder ${policy}: keep ${keepN}, hide ${hideIds.length}, delete ${deleteRows.length}.`);

    // Always write a review sheet of what WOULD be removed (venue + URL + reviews + reason) so the
    // operator can scan / spot-check before --apply. Review-before-apply is the safe workflow:
    // a real HH hiding behind a menu PDF (e.g. Lucky Silver) is caught here, not after the write.
    const removals = verdicts
      .filter((x) => x.verdict.action !== "keep")
      .sort((a, b) =>
        a.verdict.action.localeCompare(b.verdict.action) || // delete before hide
        a.row.city.localeCompare(b.row.city) ||
        (b.row.reviews ?? 0) - (a.row.reviews ?? 0));
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const sheet = ["city,action,venue,primary_type,reviews,website,reason"];
    for (const { row, verdict } of removals) {
      sheet.push([esc(row.city), verdict.action, esc(row.name), row.primary_type ?? "",
        row.reviews ?? "", esc(row.website_url), esc(verdict.reason)].join(","));
    }
    const sheetPath = `docs/cleanup-stubs-${policy}${cityArgs ? `-${cityArgs.slug}` : ""}.csv`;
    fs.writeFileSync(sheetPath, sheet.join("\n"));
    console.log(`Review sheet (venue + URL + reviews + reason) → ${sheetPath}  (${removals.length} rows)`);

    if (verbose) {
      for (const action of ["delete", "hide"] as const) {
        const list = verdicts.filter((x) => x.verdict.action === action);
        if (list.length === 0) continue;
        console.log(`\n  ${action.toUpperCase()} (${list.length}):`);
        for (const { row, verdict } of list) {
          console.log(`    - [${row.city}] ${row.name}  (${row.primary_type ?? "?"}, ${row.website_url ?? "no site"}) — ${verdict.reason}`);
        }
      }
    }

    if (!apply) {
      console.log(`\n(dry-run) nothing changed. Re-run with --apply to hide ${hideIds.length} and soft-delete ${deleteRows.length}.`);
      return;
    }
    if (hideIds.length === 0 && deleteRows.length === 0) return;

    const deleteIds = deleteRows.map((x) => x.row.id);
    await sql.begin(async (tx) => {
      if (hideIds.length > 0) {
        await tx`UPDATE venues SET status = 'no_happy_hour', updated_at = now() WHERE id = ANY(${hideIds}) AND status = 'active'`;
        for (const { row, verdict } of verdicts.filter((x) => x.verdict.action === "hide")) {
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('venues', ${row.id}, ${tx.json({ status: "active" })}, ${tx.json({ status: "no_happy_hour" })},
                    'script', ${`cleanup-stubs hide (${verdict.reason})`})
          `;
        }
      }
      if (deleteIds.length > 0) {
        await tx`UPDATE happy_hours SET active = false, updated_at = now() WHERE venue_id = ANY(${deleteIds}) AND active = true AND deleted_at IS NULL`;
        await tx`UPDATE venues SET deleted_at = now(), updated_at = now() WHERE id = ANY(${deleteIds})`;
        for (const { row, verdict } of deleteRows) {
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('venues', ${row.id}, ${tx.json({ deletedAt: null })}, ${tx.json({ deletedAt: "now" })},
                    'script', ${`cleanup-stubs delete (${verdict.reason})`})
          `;
        }
      }
    });
    console.log(`\nApplied: hid ${hideIds.length}, soft-deleted ${deleteIds.length}.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
