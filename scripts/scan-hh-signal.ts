/**
 * scan-hh-signal — $0 sharpening of the no_hh_found partition. For every reachable
 * has-site miss, re-fetch the SAME pages the model was fed and check whether the
 * literal text actually contains a happy-hour signal. No model call.
 *
 * Splits the misses into:
 *   says_happy_hour   the text we fed the model literally contains "happy hour"/"hh"
 *                     yet 0 windows were extracted → REAL extraction miss (the bug).
 *   says_special_only "special(s)" or a time-range like "3-6pm" but no "happy hour"
 *                     → likely an all-day/industry-night deal worth a closer look.
 *   no_signal         we fed pages with NO happy-hour wording → correct no_hh_found
 *                     (the /menu link was a food menu; HH simply isn't published here).
 *   unreachable       fetchPages returned nothing (robots/UA/JS) — counted separately.
 *
 * Usage: tsx scripts/scan-hh-signal.ts --city tucson --state az [--limit N]
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { triageSite } from "@/lib/places/siteTriage";
import { fetchPages } from "@/lib/ai/siteContent";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const HH = /happy\s*hour|happy\s*hr\b/i;
const SPECIAL = /special|drink\s*deal|\bdaily\b|industry\s*night|\b\d{1,2}\s*(?:am|pm)?\s*[-–to]+\s*\d{1,2}\s*(?:am|pm)\b/i;

type Bucket = "says_happy_hour" | "says_special_only" | "no_signal" | "unreachable";

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return { limit: get("--limit") ? parseInt(get("--limit")!, 10) : null };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  const args = parseArgs();
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const city = await resolveCity(sql, slug, state);
    const cands = await sql<{ name: string; primary_type: string | null; website_url: string }[]>`
      SELECT name, primary_type, website_url FROM seed_candidates
      WHERE city_id = ${city.id} AND outcome = 'no_hh_found' AND website_url IS NOT NULL
      ORDER BY user_rating_count DESC NULLS LAST
      ${args.limit ? sql`LIMIT ${args.limit}` : sql``}`;

    console.log(`Scanning ${cands.length} misses for on-page HH wording in ${city.name}…\n`);
    const rows = await pool(cands, 8, async (c, i) => {
      const v = await triageSite({ websiteUri: c.website_url, name: c.name, cityName: null });
      let bucket: Bucket = "unreachable";
      let snippet = "";
      if (v.kind !== "social_only" && v.decision !== "kill") {
        const pages = await fetchPages([...v.hhSignalUrls, v.url], 5);
        const text = pages.map((p) => p.text ?? "").join("\n");
        if (pages.length === 0) bucket = "unreachable";
        else if (HH.test(text)) {
          bucket = "says_happy_hour";
          const m = text.match(/.{0,40}happy\s*hour.{0,40}/i);
          snippet = m ? m[0].replace(/\s+/g, " ").trim() : "";
        } else if (SPECIAL.test(text)) bucket = "says_special_only";
        else bucket = "no_signal";
      }
      process.stdout.write(`\r  [${i + 1}/${cands.length}] ${bucket.padEnd(17)} ${c.name.slice(0, 38)}`.padEnd(80));
      return { name: c.name, primaryType: c.primary_type, website: c.website_url, bucket, snippet };
    });
    process.stdout.write("\n\n");

    const order: Bucket[] = ["says_happy_hour", "says_special_only", "no_signal", "unreachable"];
    const lab: Record<Bucket, string> = {
      says_happy_hour: 'text literally says "happy hour" — extracted 0 (REAL MISS)',
      says_special_only: '"specials"/time-range but no "happy hour" (look closer)',
      no_signal: "no HH wording on fed pages (correct no_hh_found)",
      unreachable: "no page fetched (robots/UA/JS/social)",
    };
    console.log("── on-page HH-signal scan ────────────────────────────────");
    for (const b of order) {
      const n = rows.filter((r) => r.bucket === b).length;
      console.log(`  ${String(n).padStart(3)}  ${((n / rows.length) * 100).toFixed(0).padStart(3)}%  ${lab[b]}`);
    }
    console.log(`  ${String(rows.length).padStart(3)}  100%  TOTAL`);

    const misses = rows.filter((r) => r.bucket === "says_happy_hour");
    console.log(`\n── REAL extraction misses (${misses.length}) — "happy hour" on a page we fed, 0 extracted ──`);
    for (const r of misses) {
      console.log(`  ${r.name.slice(0, 34).padEnd(34)} ${(r.primaryType ?? "").padEnd(18)} ${r.website}`);
      if (r.snippet) console.log(`        …${r.snippet}…`);
    }

    // Real run date — a fixed stamp made re-runs silently clobber the prior report
    // (the Scottsdale 2026-06-01 scan was overwritten by a 2026-06-11 re-run).
    const path = `docs/${city.slug}-hh-signal-scan-${new Date().toISOString().slice(0, 10)}.json`;
    await writeFile(path, JSON.stringify(rows, null, 2), "utf8");
    console.log(`\nFull detail → ${path}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
