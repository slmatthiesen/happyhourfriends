/**
 * analyze:discovery-channels — cost instrumentation readout (2026-06-26).
 *
 * Discovery has two Google channels with very different cost: the Nearby sweep (expensive —
 * ~$0.040/tile × hundreds of tiles in a dense city) and the HH-recall Text Search (cheap —
 * ~30 calls/city). seed:discover now tags every candidate with which channel(s) surfaced it
 * (seen_via_nearby / seen_via_hh_recall, OR-merged across runs). This report answers the only
 * question that decides whether we can cap the Nearby budget:
 *
 *   How many LIVE happy hours are reachable ONLY via the expensive Nearby sweep?
 *
 * If that number is small, recall + a light Nearby cap would keep nearly all the live HH at a
 * fraction of the cost. If it's large, the sweep is earning its keep. Either way it's evidence,
 * not a guess. $0 — read-only.
 *
 *   pnpm tsx scripts/analyze-discovery-channels.ts --city <slug> --state <code>
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const { slug, state } = requireCityArgs();
  const c = await resolveCity(sql, slug, state);

  // One row per discovery candidate, tagged with its channel(s) and whether it became a
  // venue with at least one LIVE happy-hour window.
  const rows = await sql<{ channel: string; candidates: number; live_hh: number }[]>`
    WITH tagged AS (
      SELECT
        CASE
          WHEN seen_via_nearby AND seen_via_hh_recall THEN 'both'
          WHEN seen_via_nearby                        THEN 'nearby_only'
          WHEN seen_via_hh_recall                     THEN 'recall_only'
          ELSE 'untagged'
        END AS channel,
        EXISTS (
          SELECT 1 FROM venues v
          JOIN happy_hours hh ON hh.venue_id = v.id
          WHERE v.id = sc.resulting_venue_id
            AND v.deleted_at IS NULL AND hh.active AND hh.deleted_at IS NULL
        ) AS is_live_hh
      FROM seed_candidates sc
      WHERE sc.city_id = ${c.id}
    )
    SELECT channel,
           COUNT(*)::int                          AS candidates,
           COUNT(*) FILTER (WHERE is_live_hh)::int AS live_hh
    FROM tagged
    GROUP BY channel
  `;

  const by = (k: string) => rows.find((r) => r.channel === k) ?? { candidates: 0, live_hh: 0 };
  const nearbyOnly = by("nearby_only");
  const recallOnly = by("recall_only");
  const both = by("both");
  const untagged = by("untagged");

  const totalLive = nearbyOnly.live_hh + recallOnly.live_hh + both.live_hh + untagged.live_hh;
  const recallReachableLive = recallOnly.live_hh + both.live_hh; // survives a Nearby cap
  const nearbyExclusiveLive = nearbyOnly.live_hh; // what a Nearby cap would cost us
  const pct = (n: number) => (totalLive ? ((n / totalLive) * 100).toFixed(1) : "0.0");

  console.log(`\nDiscovery-channel yield — ${c.name} (read-only, $0)\n`);
  if (untagged.candidates > 0 && nearbyOnly.candidates + recallOnly.candidates + both.candidates === 0) {
    console.log(
      `  ⚠ All ${untagged.candidates} candidates are UNTAGGED — this city was discovered before\n` +
        `    channel instrumentation shipped. Re-run seed:discover (or onboard a new city) to populate.\n`,
    );
  }
  console.log("  channel        candidates   live HH");
  console.log("  ───────────────────────────────────");
  for (const [label, r] of [
    ["nearby_only", nearbyOnly],
    ["recall_only", recallOnly],
    ["both", both],
    ["untagged", untagged],
  ] as const) {
    console.log(`  ${label.padEnd(13)} ${String(r.candidates).padStart(8)} ${String(r.live_hh).padStart(9)}`);
  }
  console.log("  ───────────────────────────────────");
  console.log(`\n  Live HH total:                 ${totalLive}`);
  console.log(`  Reachable via HH-recall:       ${recallReachableLive}  (${pct(recallReachableLive)}%)  ← survives a Nearby cap`);
  console.log(`  Exclusive to the Nearby sweep: ${nearbyExclusiveLive}  (${pct(nearbyExclusiveLive)}%)  ← cost of capping Nearby`);
  console.log(
    `\n  Read: if "exclusive to the Nearby sweep" is small, lean discovery on HH-recall and cap\n` +
      `  the Nearby tile budget (RECALL_MAX_CALLS up, a Nearby --max-tiles down) to cut Google spend.\n`,
  );

  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
