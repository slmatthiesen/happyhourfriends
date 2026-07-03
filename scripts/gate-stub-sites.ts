/**
 * gate-stub-sites — first-party curation pass over a city's help-wanted stubs.
 *
 * For every no-HH stub, decide keep/hide from the venue's OWN site (lib/places/stubSiteGate):
 * alcohol-positive type/name → keep; dead/parked site → hide; live site with no alcohol or HH
 * evidence → hide. This trusts the venue's page over Google's unreliable type/serves_alcohol
 * flag, so counter-service lunch spots (Achilles) drop while real bars/wine bars stay.
 *
 * Dry-run by default (writes a review CSV). --apply hides the HIDE set (status='no_happy_hour',
 * reversible, audit-logged). $0 — plain HTTP fetches, no model calls.
 *
 *   pnpm tsx scripts/gate-stub-sites.ts --city santa-cruz --state ca            # dry-run + CSV
 *   pnpm tsx scripts/gate-stub-sites.ts --city santa-cruz --state ca --apply    # hide the set
 */
import "dotenv/config";
import fs from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { fetchUrl } from "@/lib/verification/fetchUrl";
import { mapWithConcurrency } from "@/lib/async/mapWithConcurrency";
import { classifyStubSite, type StubSiteVerdict } from "@/lib/places/stubSiteGate";
import { hasAlcoholSignal, isBowlingAlley } from "@/lib/places/chainDenylist";

interface Row {
  id: string;
  name: string;
  website_url: string | null;
  hh_page_url: string | null;
  primary_type: string | null;
  types: string[] | null;
}

const arg = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function fetchSiteText(row: Row): Promise<{ reachable: boolean; text: string; unreadable: boolean }> {
  const urls = [row.website_url, row.hh_page_url].filter((u): u is string => !!u);
  let reachable = false;
  let unreadable = false; // alive but couldn't read (bot-wall / robots / 403) — not "dead"
  let text = "";
  for (const u of urls) {
    try {
      const r = await fetchUrl(u);
      if (r.ok && r.contentText) {
        reachable = true;
        text += " " + r.contentText;
      } else if (r.ok) {
        reachable = true; // 200 but empty/binary — classifier treats thin text as parked
      } else if (r.blocked === "bot_wall" || r.blockedByRobots || r.status === 403 || r.status === 406 || r.status === 451) {
        unreadable = true;
      }
    } catch {
      /* network error → leave unreachable unless another url succeeds */
    }
  }
  return { reachable, text, unreadable };
}

async function main() {
  const { slug, state } = requireCityArgs();
  const apply = process.argv.includes("--apply");
  const undo = process.argv.includes("--undo");
  const limit = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
  const concurrency = Number(arg("--concurrency") ?? "6");

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    // --undo: restore every venue THIS gate hid in the city back to a visible stub. Lets us
    // re-baseline after a policy change without manual SQL. Audit-logged.
    if (undo) {
      const restored = await sql<{ id: string; name: string }[]>`
        UPDATE venues v SET status = 'active', updated_at = now()
        FROM cities c
        WHERE v.city_id = c.id AND lower(c.slug) = ${slug} AND lower(c.state) = ${state.toLowerCase()}
          AND v.status = 'no_happy_hour'
          AND EXISTS (
            SELECT 1 FROM audit_log a
            WHERE a.table_name = 'venues' AND a.row_id = v.id AND a.reason LIKE 'gate-stub-sites hide%'
          )
        RETURNING v.id, v.name
      `;
      for (const r of restored) {
        await sql`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('venues', ${r.id}, ${sql.json({ status: "no_happy_hour" })}, ${sql.json({ status: "active" })}, 'script', 'gate-stub-sites undo')`;
      }
      console.log(`--undo: restored ${restored.length} venue(s) to active stubs in ${slug}/${state}.`);
      return;
    }
    const rows = await sql<Row[]>`
      SELECT v.id, v.name, v.website_url, v.hh_page_url, sc.primary_type, sc.types
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      LEFT JOIN seed_candidates sc ON sc.google_place_id = v.google_place_id
      WHERE v.deleted_at IS NULL AND v.status = 'active' AND v.data_completeness = 'stub'
        -- HARD INVARIANT: never touch a venue that has ANY happy-hour window on record —
        -- active OR hidden-for-review. Offerings hang off happy_hours, so this also guarantees
        -- a venue with a published offering is never hidden. The gate only ever acts on true
        -- help-wanted stubs (zero HH data); a published window/offering is sacrosanct.
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h WHERE h.venue_id = v.id AND h.deleted_at IS NULL
        )
        AND lower(c.slug) = ${slug} AND lower(c.state) = ${state.toLowerCase()}
      ORDER BY v.name
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
    console.log(`gate-stub-sites — ${rows.length} stub(s) in ${slug}/${state}${apply ? "" : "  (dry-run)"}\n`);

    const verdicts = await mapWithConcurrency(
      rows,
      concurrency,
      async (row): Promise<{ row: Row; verdict: StubSiteVerdict }> => {
        // Decide without a fetch where possible. Bowling alleys always hide; alcohol-positive and
        // no-site venues are kept as crowdsource stubs (conservative policy — only dead/parked hide).
        if (isBowlingAlley(row.name, row.primary_type, row.types)) {
          return { row, verdict: { action: "hide", reason: "bowling alley (excluded type)" } };
        }
        if (hasAlcoholSignal(row.name, row.primary_type, row.types)) {
          return { row, verdict: { action: "keep", reason: "alcohol-positive type/name" } };
        }
        if (!row.website_url) return { row, verdict: { action: "keep", reason: "no website — crowdsource stub" } };
        const { reachable, text, unreadable } = await fetchSiteText(row);
        const verdict = classifyStubSite({
          name: row.name, primaryType: row.primary_type, types: row.types,
          siteReachable: reachable, siteText: text, siteUnreadable: unreadable,
        });
        return { row, verdict };
      },
      { minSpacingMs: 80 },
    );

    const hide = verdicts.filter((v) => v.verdict.action === "hide");
    const keep = verdicts.filter((v) => v.verdict.action === "keep");
    console.log(`keep ${keep.length}, hide ${hide.length}`);
    const byReason = new Map<string, number>();
    for (const h of hide) byReason.set(h.verdict.reason, (byReason.get(h.verdict.reason) ?? 0) + 1);
    for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  hide: ${n.toString().padStart(3)}  ${r}`);

    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const sheet = ["action,venue,primary_type,website,reason"];
    for (const { row, verdict } of [...hide, ...keep]) {
      sheet.push([verdict.action, esc(row.name), row.primary_type ?? "", esc(row.website_url), esc(verdict.reason)].join(","));
    }
    const out = arg("--out") ?? `docs/gate-stub-sites-${slug}.csv`;
    fs.writeFileSync(out, sheet.join("\n") + "\n");
    console.log(`\nReview sheet → ${out}`);

    if (!apply) {
      console.log(`\n(dry-run) nothing changed. Re-run with --apply to hide ${hide.length}.`);
      return;
    }
    if (hide.length === 0) return;
    const hideIds = hide.map((h) => h.row.id);
    await sql.begin(async (tx) => {
      await tx`UPDATE venues SET status = 'no_happy_hour', updated_at = now() WHERE id = ANY(${hideIds}) AND status = 'active'`;
      for (const { row, verdict } of hide) {
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('venues', ${row.id}, ${tx.json({ status: "active" })}, ${tx.json({ status: "no_happy_hour" })},
                  'script', ${`gate-stub-sites hide (${verdict.reason})`})
        `;
      }
    });
    console.log(`\nApplied: hid ${hide.length}.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
