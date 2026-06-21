/**
 * scan-stub-signal — $0 pre-spend triage of a city's STUB venues (no live happy hour).
 * For every stub with a website, run the SAME triage + page-fetch the paid extractor would,
 * then apply the SAME free gate (`pagesHaveExtractableSignal`) that decides whether a page is
 * even worth a Claude token. No model call, no spend.
 *
 * Why not reextract:stubs --dry-run? That only runs triage, which keeps every reachable site
 * (it kills only dead/social domains) — so it can't tell you which stubs the paid run would
 * actually pay to read. This applies the text-level signal gate, the real spend predictor.
 *
 * Why not scan-hh-signal? That is keyed to seed_candidates.outcome='no_hh_found' and misses
 * stubs that were never enriched or arrived via the HH text-search recall pass. This scans the
 * stub VENUE population directly (same query as reextract:stubs), so coverage is complete.
 *
 * Buckets, strongest → weakest:
 *   happy_hour    a fed page literally says "happy hour" — highest-yield, pay first.
 *   deal_or_menu  no "happy hour", but a price / deal word / menu PDF|image the free parser
 *                 can't read — worth a paid look (deals may live in the doc).
 *   no_signal     no HH/deal wording on any fed page — the paid run SKIPS these at $0 anyway.
 *   social_only   triage killed it (social/ordering host or dead domain) — not extractable.
 *   unreachable   reachable verdict but no page fetched (robots/UA/JS wall).
 *
 * Usage: tsx scripts/scan-stub-signal.ts --city santa-barbara --state CA [--limit N]
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { triageSite } from "@/lib/places/siteTriage";
import { fetchPages, pagesHaveExtractableSignal } from "@/lib/ai/siteContent";
import { hhOrDealMatch } from "@/lib/places/hhText";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const HH = /happy\s*hour|happy\s*hr\b/i;

type Bucket = "happy_hour" | "deal_or_menu" | "no_signal" | "social_only" | "unreachable";

interface StubRow {
  name: string;
  primary_type: string | null;
  website_url: string;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const i = a.indexOf("--limit");
  return { limit: i >= 0 ? parseInt(a[i + 1], 10) : null };
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
    // Same population as reextract:stubs (default): active stubs with a website, no live HH.
    const stubs = await sql<StubRow[]>`
      SELECT v.name, sc.primary_type, v.website_url
      FROM venues v
      LEFT JOIN seed_candidates sc ON sc.resulting_venue_id = v.id
      WHERE v.city_id = ${city.id}
        AND v.status = 'active'
        AND v.data_completeness = 'stub'
        AND v.website_url IS NOT NULL
        AND v.deleted_at IS NULL
      ORDER BY v.name
      ${args.limit ? sql`LIMIT ${args.limit}` : sql``}`;

    console.log(`Scanning ${stubs.length} stub venue(s) for on-page HH/deal signal in ${city.name}…\n`);
    const rows = await pool(stubs, 8, async (v, i) => {
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      let bucket: Bucket = "unreachable";
      let snippet = "";
      if (verdict.kind === "social_only" || verdict.decision === "kill") {
        bucket = "social_only";
      } else {
        const pages = await fetchPages([...verdict.hhSignalUrls, verdict.url], 5);
        if (pages.length === 0) {
          bucket = "unreachable";
        } else {
          const text = pages.map((p) => p.text ?? "").join("\n");
          if (HH.test(text)) {
            bucket = "happy_hour";
            const m = text.match(/.{0,40}happy\s*hour.{0,40}/i);
            snippet = m ? m[0].replace(/\s+/g, " ").trim() : "";
          } else if (pagesHaveExtractableSignal(pages)) {
            bucket = "deal_or_menu";
            snippet = hhOrDealMatch(text) ?? "(menu PDF/image)";
          } else {
            bucket = "no_signal";
          }
        }
      }
      process.stdout.write(`\r  [${i + 1}/${stubs.length}] ${bucket.padEnd(13)} ${v.name.slice(0, 38)}`.padEnd(80));
      return { name: v.name, primaryType: v.primary_type, website: v.website_url, bucket, snippet };
    });
    process.stdout.write("\n\n");

    const order: Bucket[] = ["happy_hour", "deal_or_menu", "no_signal", "social_only", "unreachable"];
    const lab: Record<Bucket, string> = {
      happy_hour: 'a fed page literally says "happy hour" (pay first — highest yield)',
      deal_or_menu: "price/deal word or menu PDF|image, no explicit HH (worth a paid look)",
      no_signal: "no HH/deal wording on any fed page (paid run skips at $0)",
      social_only: "social/ordering host or dead domain (not extractable)",
      unreachable: "reachable verdict but no page fetched (robots/UA/JS wall)",
    };
    const count = (b: Bucket) => rows.filter((r) => r.bucket === b).length;
    console.log("── stub on-page signal scan ──────────────────────────────");
    for (const b of order) {
      const n = count(b);
      console.log(`  ${String(n).padStart(3)}  ${((n / rows.length) * 100).toFixed(0).padStart(3)}%  ${lab[b]}`);
    }
    console.log(`  ${String(rows.length).padStart(3)}  100%  TOTAL`);

    const payWorth = count("happy_hour") + count("deal_or_menu");
    console.log(
      `\n  Signal-positive (would pay): ${payWorth}  →  ≈ $${(payWorth * 0.015).toFixed(2)} batch / $${(payWorth * 0.03).toFixed(2)} --quick.\n` +
        `  The other ${rows.length - payWorth} cost $0 (paid run skips no-signal/unreachable/social).`,
    );

    const strong = rows.filter((r) => r.bucket === "happy_hour");
    console.log(`\n── "happy hour" on page, currently a stub (${strong.length}) ──`);
    for (const r of strong) {
      console.log(`  ${r.name.slice(0, 34).padEnd(34)} ${(r.primaryType ?? "").padEnd(18)} ${r.website}`);
      if (r.snippet) console.log(`        …${r.snippet}…`);
    }

    const path = `docs/${city.slug}-stub-signal-${new Date().toISOString().slice(0, 10)}.json`;
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
