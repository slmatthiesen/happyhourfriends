/**
 * diagnose-no-hh — $0 partition of `no_hh_found` venues by ROOT CAUSE.
 *
 * For every seed_candidate that ended `no_hh_found` and has a website, this replays
 * EXACTLY what the enrich pipeline would do up to (but NOT including) the model call:
 *   1. triageSite()  — fetch the homepage (browser UA), discover HH/menu links.
 *   2. fetchPages()  — fetch the pages the model WOULD be fed (bot UA, robots-aware).
 * It never calls Anthropic, so it is free. The goal is to size the RECOVERABLE
 * fraction of misses and say WHICH fix each needs.
 *
 * Buckets:
 *   social_only        triage says the only URL is Facebook/IG/ordering → Mint-Bar class,
 *                      HH not on a crawlable site. Not recoverable at scale.
 *   dead_or_parked     site is actually gone — should have been killed, not stubbed.
 *   fetch_blocked      triage reached the site, but fetchPages got ZERO usable pages
 *                      (robots.txt / bot-UA wall / timeout). Model was fed nothing.
 *                      RECOVERABLE: align UA / relax robots for our own fetch.
 *   js_shell           pages fetched but almost no text and no PDF → SPA husk.
 *                      RECOVERABLE only with JS rendering.
 *   hh_page_empty      we DID find an HH/menu link AND fetched real content, yet the
 *                      run still recorded nothing → extraction failure (bucket "A").
 *                      Investigate: re-run a few through the model.
 *   no_link_has_text   reachable, real homepage text, but no HH-signal link found →
 *                      HH page undiscovered, or genuinely not published (bucket "B").
 *
 * Usage: tsx scripts/diagnose-no-hh.ts --city tucson [--limit N] [--types bar,bar_and_grill]
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { triageSite } from "@/lib/places/siteTriage";
import { fetchPages } from "@/lib/ai/siteContent";

const SHELL_TEXT_FLOOR = 600; // chars of usable text below which we call it a JS husk

type Bucket =
  | "social_only"
  | "dead_or_parked"
  | "fetch_blocked"
  | "js_shell"
  | "hh_page_empty"
  | "no_link_has_text";

interface Row {
  name: string;
  primaryType: string | null;
  website: string;
  ratings: number | null;
  bucket: Bucket;
  triageDecision: string;
  reachability: string | null;
  hhLinks: number;
  pagesFetched: number;
  textChars: number;
  hasPdf: boolean;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    city: get("--city") ?? "tucson",
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : null,
    types: get("--types")?.split(",").map((s) => s.trim()) ?? null,
  };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function classify(c: {
  name: string;
  primary_type: string | null;
  website_url: string;
  user_rating_count: number | null;
}): Promise<Row> {
  const base: Omit<Row, "bucket"> = {
    name: c.name,
    primaryType: c.primary_type,
    website: c.website_url,
    ratings: c.user_rating_count,
    triageDecision: "",
    reachability: null,
    hhLinks: 0,
    pagesFetched: 0,
    textChars: 0,
    hasPdf: false,
  };

  const verdict = await triageSite({ websiteUri: c.website_url, name: c.name, cityName: null });
  base.triageDecision = verdict.decision;
  base.reachability = verdict.reachability;
  base.hhLinks = verdict.hhSignalUrls.length;

  if (verdict.kind === "social_only") return { ...base, bucket: "social_only" };
  if (verdict.decision === "kill") return { ...base, bucket: "dead_or_parked" };

  // Replay what the model would be fed: the discovered HH/menu links first, then the site.
  const pages = await fetchPages([...verdict.hhSignalUrls, verdict.url], 5);
  const textChars = pages.reduce((n, p) => n + (p.text?.length ?? 0), 0);
  const hasPdf = pages.some((p) => p.pdfBase64);
  base.pagesFetched = pages.length;
  base.textChars = textChars;
  base.hasPdf = hasPdf;

  if (pages.length === 0) return { ...base, bucket: "fetch_blocked" };
  if (textChars < SHELL_TEXT_FLOOR && !hasPdf) return { ...base, bucket: "js_shell" };
  if (verdict.hhSignalUrls.length > 0 && (textChars >= SHELL_TEXT_FLOOR || hasPdf))
    return { ...base, bucket: "hh_page_empty" };
  return { ...base, bucket: "no_link_has_text" };
}

async function main() {
  const args = parseArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [city] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM cities WHERE slug = ${args.city}
    `;
    if (!city) throw new Error(`city '${args.city}' not found`);

    const cands = await sql<
      { name: string; primary_type: string | null; website_url: string; user_rating_count: number | null }[]
    >`
      SELECT name, primary_type, website_url, user_rating_count
      FROM seed_candidates
      WHERE city_id = ${city.id}
        AND outcome = 'no_hh_found'
        AND website_url IS NOT NULL
        ${args.types ? sql`AND primary_type = ANY(${args.types})` : sql``}
      ORDER BY user_rating_count DESC NULLS LAST
      ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
    `;

    console.log(`Diagnosing ${cands.length} no_hh_found+has-site candidates in ${city.name}…\n`);
    const rows = await pool(cands, 8, async (c, i) => {
      const r = await classify(c);
      process.stdout.write(`\r  [${i + 1}/${cands.length}] ${r.bucket.padEnd(16)} ${r.name.slice(0, 40)}`.padEnd(80));
      return r;
    });
    process.stdout.write("\n\n");

    const order: Bucket[] = [
      "hh_page_empty",
      "fetch_blocked",
      "no_link_has_text",
      "js_shell",
      "social_only",
      "dead_or_parked",
    ];
    const label: Record<Bucket, string> = {
      hh_page_empty: "A · HH page fed, 0 extracted (EXTRACTION BUG)",
      fetch_blocked: "robots/UA-blocked our fetch (RECOVERABLE)",
      no_link_has_text: "B · reachable, no HH link found",
      js_shell: "C · JS husk (needs rendering)",
      social_only: "D · social/ordering only (Mint-Bar class)",
      dead_or_parked: "dead/parked (should've been killed)",
    };

    console.log("── no_hh_found root-cause partition ──────────────────────");
    for (const b of order) {
      const n = rows.filter((r) => r.bucket === b).length;
      const pct = ((n / rows.length) * 100).toFixed(0);
      console.log(`  ${String(n).padStart(3)}  ${pct.padStart(3)}%  ${label[b]}`);
    }
    console.log(`  ${String(rows.length).padStart(3)}  100%  TOTAL`);

    // The two actionable buckets, named.
    for (const b of ["hh_page_empty", "fetch_blocked"] as Bucket[]) {
      const list = rows.filter((r) => r.bucket === b);
      if (!list.length) continue;
      console.log(`\n── ${label[b]} (${list.length}) ──`);
      for (const r of list.slice(0, 30)) {
        console.log(
          `  ${r.name.slice(0, 34).padEnd(34)} ${(r.primaryType ?? "").padEnd(18)} ` +
            `links=${r.hhLinks} pages=${r.pagesFetched} text=${r.textChars}${r.hasPdf ? " +PDF" : ""}  ${r.website}`,
        );
      }
    }

    const reportPath = `docs/${args.city}-no-hh-diagnosis-2026-06-01.json`;
    await writeFile(reportPath, JSON.stringify(rows, null, 2), "utf8");
    console.log(`\nFull per-venue detail → ${reportPath}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
