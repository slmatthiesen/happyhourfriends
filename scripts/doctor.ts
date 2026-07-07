/**
 * doctor — $0 all-cities health gate. One row per live city, PASS/FAIL/WARN per check,
 * exit 1 if anything FAILs. The deterministic entry point of docs/runbook-audit-city.md:
 * every FAIL prints the exact runbook step that fixes it.
 *
 * Checks (all read-only SQL against the local DB — no API, no spend):
 *   nbhd    FAIL  neighborhood coverage <95% of active venues        → runbook §nbhd
 *   poly    FAIL  city has ZERO neighborhood polygons (cardinal-districts step skipped)
 *   recall  FAIL  no seed candidate was ever seen via HH recall (adaptive v2 never swept)
 *   bare    WARN  live windows with zero offerings (deals likely in a PDF/image we missed)
 *   junk    WARN  live offerings whose name is a bare deal phrase ("$1 off", "BOGO")
 *   flags   WARN  data_audit rows still unreviewed (resolution='scanned')
 *   stubs   info  stub ratio (high is inherent post-launch — crowdsourcing fills it)
 *
 * (No NULL-timezone check: lib/queries/venues.ts coalesces venue tz -> city default
 * at read time, so a null venue tz is display-benign.)
 *
 * Usage:
 *   pnpm doctor                                  # every live city
 *   pnpm doctor -- --city santa-cruz --state ca  # one city (any status)
 */
import "dotenv/config";
import postgres from "postgres";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cityArg = argVal("--city");
const stateArg = argVal("--state");
if ((cityArg && !stateArg) || (!cityArg && stateArg)) {
  console.error("Provide BOTH --city <slug> and --state <code>, or neither.");
  process.exit(2);
}

const NBHD_MIN_PCT = 95;

// Deal-phrase-only offering names — the price leaked into the name and the item was
// lost. Mirrors the deal-only heuristic in scripts/audit-weak-offerings.ts (which is
// the full per-venue report; this is just the count).
const JUNK_NAME_SQL = `(
  o.name ~* '^\\s*[$]?\\d+([.]\\d{1,2})?\\s*(off)?\\s*$'
  OR o.name ~* '^\\s*(\\d+\\s*%\\s*off|half\\s*off|bogo|2\\s*for\\s*1)\\s*$'
)`;

type CityRow = {
  id: string;
  slug: string;
  state: string;
  status: string;
  venues: number;
  nbhd_assigned: number;
  polygons: number;
  recall_seen: boolean;
  bare_windows: number;
  junk_offerings: number;
  open_flags: number;
  live_venues: number;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });

  const cities = await sql<CityRow[]>`
    SELECT c.id, c.slug, c.state, c.status,
      (SELECT count(*)::int FROM venues v
        WHERE v.city_id = c.id AND v.deleted_at IS NULL AND v.status = 'active') AS venues,
      (SELECT count(*)::int FROM venues v
        WHERE v.city_id = c.id AND v.deleted_at IS NULL AND v.status = 'active'
          AND v.neighborhood_id IS NOT NULL) AS nbhd_assigned,
      (SELECT count(*)::int FROM neighborhoods n
        WHERE n.city_id = c.id AND n.polygon IS NOT NULL) AS polygons,
      EXISTS (SELECT 1 FROM seed_candidates sc
        WHERE sc.city_id = c.id AND sc.seen_via_hh_recall IS TRUE) AS recall_seen,
      (SELECT count(*)::int FROM happy_hours hh
        JOIN venues v ON v.id = hh.venue_id
        WHERE v.city_id = c.id AND v.deleted_at IS NULL
          AND hh.active AND hh.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM offerings o
            WHERE o.happy_hour_id = hh.id AND o.active)) AS bare_windows,
      (SELECT count(*)::int FROM offerings o
        JOIN happy_hours hh ON hh.id = o.happy_hour_id
        JOIN venues v ON v.id = hh.venue_id
        WHERE v.city_id = c.id AND v.deleted_at IS NULL
          AND hh.active AND hh.deleted_at IS NULL AND o.active
          AND ${sql.unsafe(JUNK_NAME_SQL)}) AS junk_offerings,
      (SELECT count(*)::int FROM data_audit da
        JOIN venues v ON v.id = da.venue_id
        WHERE v.city_id = c.id AND v.deleted_at IS NULL
          AND da.resolution = 'scanned'
          AND jsonb_array_length(da.flags) > 0) AS open_flags,
      (SELECT count(*)::int FROM venues v
        WHERE v.city_id = c.id AND v.deleted_at IS NULL AND v.status = 'active'
          AND EXISTS (SELECT 1 FROM happy_hours hh
            WHERE hh.venue_id = v.id AND hh.active AND hh.deleted_at IS NULL)) AS live_venues
    FROM cities c
    WHERE ${
      cityArg
        ? sql`c.slug = ${cityArg} AND lower(c.state) = ${stateArg!.toLowerCase()}`
        : sql`c.status = 'live'`
    }
    ORDER BY c.state, c.slug`;

  if (cities.length === 0) {
    console.error(cityArg ? `No city ${cityArg} (${stateArg})` : "No live cities.");
    process.exit(2);
  }

  type Failure = { city: string; check: string; fix: string };
  const failures: Failure[] = [];

  const header = ["city", "venues", "nbhd", "poly", "recall", "bare", "junk", "flags", "stubs"];
  const rows: string[][] = [header];

  for (const c of cities) {
    const city = `${c.slug} (${c.state})`;
    const nbhdPct = c.venues === 0 ? 100 : (100 * c.nbhd_assigned) / c.venues;
    const stubPct = c.venues === 0 ? 0 : Math.round(100 * (1 - c.live_venues / c.venues));

    const nbhdOk = nbhdPct >= NBHD_MIN_PCT;
    if (!nbhdOk)
      failures.push({ city, check: "nbhd", fix: "runbook-audit-city §Neighborhoods → backfill:neighborhoods, then analyze:neighborhood-coverage" });
    const polyOk = c.polygons > 0;
    if (!polyOk)
      failures.push({ city, check: "poly", fix: "generate:cardinal-districts was skipped — runbook-onboard-city Phase 5" });
    if (!c.recall_seen)
      failures.push({ city, check: "recall", fix: "adaptive HH recall never swept — seed:discover --hh-recall-only (resume to completion), runbook-audit-city §Recall" });

    rows.push([
      city,
      String(c.venues),
      nbhdOk ? `${nbhdPct.toFixed(1)}%` : `FAIL ${nbhdPct.toFixed(1)}%`,
      polyOk ? String(c.polygons) : "FAIL 0",
      c.recall_seen ? "ok" : "FAIL",
      c.bare_windows === 0 ? "0" : `⚠ ${c.bare_windows}`,
      c.junk_offerings === 0 ? "0" : `⚠ ${c.junk_offerings}`,
      c.open_flags === 0 ? "0" : `⚠ ${c.open_flags}`,
      `${stubPct}%`,
    ]);
  }

  const widths = header.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const [i, r] of rows.entries()) {
    console.log(r.map((cell, j) => cell.padEnd(widths[j] + 2)).join(""));
    if (i === 0) console.log(widths.map((w) => "-".repeat(w + 2)).join(""));
  }

  console.log(
    "\nWARN columns (no exit-1): bare → audit:bare-windows + reextract:stubs --bare · " +
      "junk → audit:weak-offerings + clean:junk-offerings · flags → /admin/flags or audit:fix. " +
      "High stubs% is inherent — crowdsourcing fills it (do NOT chase with paid re-extraction).",
  );

  if (failures.length > 0) {
    console.log(`\n${failures.length} FAIL(s):`);
    for (const f of failures) console.log(`  ${f.city} [${f.check}] → ${f.fix}`);
    await sql.end();
    process.exit(1);
  }
  console.log("\nAll cities PASS.");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
