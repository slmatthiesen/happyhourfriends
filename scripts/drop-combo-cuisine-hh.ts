/**
 * drop:combo-cuisine-hh — operator rule (2026-06-16): at cuisines where a "special" is a
 * lunch/dinner COMBO not a happy hour (Chinese, hot pot, dim sum, ramen, noodle, pan-Asian),
 * a captured HH window is noise UNLESS there is OVERWHELMING evidence it's a real happy hour:
 *   explicit happy-hour wording (offering/notes/source-URL) AND ≥1 DRINK offering.
 * Windows failing that bar are SOFT-DELETED (deleted_at + active=false) so they stop
 * resurfacing in review — not merely hidden. Reversible (clear deleted_at). $0, no AI.
 *
 *   pnpm tsx scripts/drop-combo-cuisine-hh.ts --city <slug> --state <code>            # dry-run
 *   pnpm tsx scripts/drop-combo-cuisine-hh.ts --city <slug> --state <code> --apply
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

/** Google primary types where specials are meal combos, not happy hours. The evidence veto
 *  below protects any of these that DOES run a real happy hour (izakaya, modern gastropub). */
const COMBO_CUISINE_TYPES = [
  "chinese_restaurant", "hot_pot_restaurant", "dim_sum_restaurant", "ramen_restaurant",
  "noodle_shop", "dumpling_restaurant", "sichuan_restaurant", "cantonese_restaurant",
  "asian_restaurant", "shabu_shabu_restaurant",
];
/** Name fallback when the google primary_type is missing/generic. Matched in Postgres via
 *  `~*`, so it MUST be word-boundary anchored: unanchored, `ramen` matches inside "Sac-ramen-to"
 *  (every "… Sacramento" venue) and would bench real HH. Postgres ARE uses `\y` for a word
 *  boundary — `\b` there means a backspace char, so the old `\bwok\b` never worked. */
const COMBO_NAME_TOKENS =
  "chinese|dim\\s?sum|hot\\s?pot|szechuan|sichuan|mandarin|hunan|cantonese|wok|dumpling|jiaozi|noodle|ramen|shabu";
const COMBO_NAME_SQL = `\\y(${COMBO_NAME_TOKENS})\\y`;
const HH_RE = /happy.?hour|\bhh\b|drink special|cocktail special|well drink|draft special|\$\d+\s*(beer|wine|cocktail|sake|soju|margarita)/i;

const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const { slug, state } = requireCityArgs();
  const c = await resolveCity(sql, slug, state);

  const rows = await sql<{
    hhId: string; venue: string; ptype: string | null; active: boolean;
    days: number[]; st: string | null; en: string | null; notes: string | null; src: string | null;
    offerText: string | null; drinkOffers: number;
  }[]>`
    SELECT h.id AS "hhId", v.name AS venue, sc.primary_type AS ptype, h.active,
           h.days_of_week AS days, h.start_time::text AS st, h.end_time::text AS en, h.notes, h.source_url AS src,
           (SELECT string_agg(coalesce(o.name,'')||' '||coalesce(o.description,''),' | ') FROM offerings o WHERE o.happy_hour_id=h.id AND o.active) AS "offerText",
           (SELECT count(*)::int FROM offerings o WHERE o.happy_hour_id=h.id AND o.active AND o.kind='drink') AS "drinkOffers"
    FROM happy_hours h
    JOIN venues v ON v.id=h.venue_id
    JOIN cities ci ON ci.id=v.city_id
    LEFT JOIN seed_candidates sc ON sc.resulting_venue_id=v.id
    WHERE ci.id=${c.id} AND h.deleted_at IS NULL
      AND ( sc.primary_type = ANY(${COMBO_CUISINE_TYPES}) OR v.name ~* ${COMBO_NAME_SQL} )
    ORDER BY v.name, h.start_time`;

  type Row = (typeof rows)[number];
  const drop: Row[] = [];
  const keep: Row[] = [];
  for (const r of rows) {
    const text = `${r.offerText ?? ""} ${r.notes ?? ""} ${r.src ?? ""}`;
    const overwhelming = HH_RE.test(text) && r.drinkOffers >= 1;
    (overwhelming ? keep : drop).push(r);
  }

  console.log(`drop:combo-cuisine-hh — ${c.name} ${APPLY ? "(APPLY)" : "(dry-run $0)"}`);
  console.log(`Combo-cuisine windows: ${rows.length} · KEEP (overwhelming HH evidence): ${keep.length} · DROP: ${drop.length}\n`);
  for (const r of drop) {
    const tm = `${(r.st ?? "?").slice(0,5)}-${(r.en ?? "close").slice(0,5)}`;
    console.log(`  ✗ ${r.venue} [${r.ptype ?? "?"}] ${r.active ? "LIVE" : "hid"} ${tm} · drinks=${r.drinkOffers}`);
  }
  for (const r of keep) console.log(`  ✓ KEEP ${r.venue} (HH wording + drink deal)`);

  if (APPLY && drop.length) {
    const ids = drop.map((r) => r.hhId);
    await sql`UPDATE happy_hours SET active=false, deleted_at=now(), updated_at=now() WHERE id IN ${sql(ids)}`;
    console.log(`\nAPPLIED: soft-deleted ${ids.length} window(s).`);
  } else if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to soft-delete.`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
