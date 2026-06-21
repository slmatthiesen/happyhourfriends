/**
 * scan:onsite-hh — $0, NO API. The "is there a happy hour right there on the site?" pass.
 *
 * For every no-live-HH stub venue with a website: fetch the site (plain HTTP, parallel), and
 * apply a 2-second garbage filter — does the page BODY actually say "happy hour" AND show a
 * time range? (Bistro 44: yes — "Happy Hour 3-7 Daily". Kodo: no — a menu page with no HH
 * wording → skipped instantly, $0.) For the real ones, run the $0 deterministic parser and
 * emit a REVIEW LIST: venue, the exact HH snippet from their site, the parsed window, and
 * whether the free parser already nailed it. No LLM, no writes — this is for you to review.
 *
 * Usage: pnpm tsx scripts/scan-onsite-hh.ts --city <slug> --state <code> [--limit N]
 * Output: docs/onsite-hh-<city>-<date>.csv  (+ top hits printed)
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";
import { parseHappyHours } from "@/lib/places/parseHhText";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { mapWithConcurrency } from "@/lib/async/mapWithConcurrency";

const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const cityArgs = requireCityArgs();
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Hit {
  venueId: string;
  name: string;
  url: string;
  snippet: string;        // the exact text on their site that says happy hour
  parsedDays: string;     // what the $0 parser made of it (may be empty)
  parsedTime: string;
  offers: number;
  freeCaught: boolean;    // did the deterministic parser produce a clean (non-suspect) window?
}

function csv(rows: Hit[]): string {
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = "freeCaught,name,url,snippet,parsedDays,parsedTime,offers,venueId";
  return [head, ...rows.map((r) => [r.freeCaught, r.name, r.url, r.snippet, r.parsedDays, r.parsedTime, r.offers, r.venueId].map(esc).join(","))].join("\n");
}

/** Real on-site happy hour, or null. Finds "happy hour" in READABLE PROSE — within ~160 chars of
 *  a weekday name or an am/pm time — and rejects matches sitting in JavaScript/CSS code (where
 *  "happy-hour" is only a route string, e.g. Kodo / the `max-age=0; path=${r}` SPA shells). */
const DAY_OR_TIME = /\b(?:mon|tues?|wed|thur?s?|fri|sat|sun)(?:day)?\b|\b\d{1,2}\s*(?::\d{2})?\s*[ap]\.?m\.?/i;
const JS_NOISE = /\$\{|function\s|max-age|expires=|path=|=>|addEventListener|var\s|charset|stylesheet/i;
function realHhSnippet(text: string): string | null {
  const clean = text.replace(/\s+/g, " ");
  const re = /happ(?:y|ier)[- ]?hours?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const win = clean.slice(Math.max(0, m.index - 40), m.index + 170);
    if (JS_NOISE.test(win)) continue;       // the match is inside code, not content
    if (DAY_OR_TIME.test(win)) return win.trim();
  }
  return null;
}

/** Registrable domain (eTLD+1-ish) of a URL — www-stripped, last two labels. */
function regDomain(u: string): string | null {
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    const p = h.split(".");
    return p.length <= 2 ? h : p.slice(-2).join(".");
  } catch { return null; }
}
/** Same business iff same registrable domain (a 301 to a different domain is NOT the venue). */
function sameSite(pageUrl: string, venueWebsite: string | null): boolean {
  const a = regDomain(pageUrl), b = venueWebsite ? regDomain(venueWebsite) : null;
  return !!a && !!b && a === b;
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL!;
  const sql = postgres(DATABASE_URL, { max: 8 });
  try {
    const city = await resolveCity(sql, cityArgs.slug, cityArgs.state);
    const stubs = await sql<{ id: string; name: string; website_url: string; primary_type: string | null }[]>`
      SELECT v.id, v.name, v.website_url, sc.primary_type
      FROM venues v
      LEFT JOIN seed_candidates sc ON sc.resulting_venue_id = v.id
      WHERE v.city_id = ${city.id} AND v.status='active' AND v.deleted_at IS NULL
        AND v.data_completeness='stub' AND v.website_url IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM happy_hours a WHERE a.venue_id=v.id AND a.active AND a.deleted_at IS NULL)
      ORDER BY v.name ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(`Scanning ${stubs.length} stub site(s) in ${city.name} for on-site happy hour — $0, no API.\n`);

    const hits: Hit[] = [];
    let scanned = 0, garbage = 0, unreadable = 0, crossDomain = 0;

    await mapWithConcurrency(stubs, 24, async (v) => {
      scanned++;
      let verdict;
      try {
        verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      } catch { unreadable++; return; }
      const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: v.primary_type, types: null, name: v.name }));
      if (decided.action !== "extract") { unreadable++; return; }

      let built;
      try {
        built = await buildExtractRequest({ venueName: v.name, websiteUrl: verdict.kind === "real" ? verdict.url : null, otherUrl: null, cityName: city.name, priorityUrls: decided.priorityUrls, noRender: true });
      } catch { unreadable++; return; }

      // THE 2-SECOND GARBAGE FILTER: a page must say "happy hour" in real prose next to a day or
      // time — not as a route string buried in JS. No such prose → skip, $0 (Kodo, SPA shells).
      // AND it must be the VENUE'S OWN domain: a stale website that 301s to a different business
      // (miniditorestaurant.com → thevillagetavernnyc.com) would otherwise hand us someone else's
      // happy hour. Reject any page whose final domain ≠ the venue's registered website domain.
      let page, snippet: string | null = null, sawForeign = false;
      for (const p of built.pages) {
        const s = realHhSnippet(p.text ?? "");
        if (!s) continue;
        if (!sameSite(p.url, v.website_url)) { sawForeign = true; continue; }
        page = p; snippet = s; break;
      }
      if (!page || !snippet) { if (sawForeign) crossDomain++; else garbage++; return; }

      const text = (page.text ?? "").replace(/\s+/g, " ");
      const parsed = parseHappyHours(text, page.url);
      const best = parsed.find((w) => w.plausible) ?? parsed[0];
      hits.push({
        venueId: v.id, name: v.name, url: page.url, snippet,
        parsedDays: best ? best.daysOfWeek.map((d) => DAY[d]).join(",") : "",
        parsedTime: best ? `${best.startTime ?? "?"}-${best.endTime ?? "close"}` : "",
        offers: best ? best.offerings.length : 0,
        freeCaught: parsed.some((w) => w.plausible),
      });
    });

    hits.sort((a, b) => Number(a.freeCaught) - Number(b.freeCaught) || b.offers - a.offers);
    const stamp = new Date().toISOString().slice(0, 10);
    const out = `docs/onsite-hh-${city.slug}-${stamp}.csv`;
    writeFileSync(out, csv(hits));

    console.log(`\n── on-site HH scan (${city.name}) ──`);
    console.log(`  scanned: ${scanned} | REAL on-site HH: ${hits.length} | no HH text (skipped $0): ${garbage} | stale redirect to a foreign domain: ${crossDomain} | unreadable: ${unreadable}`);
    console.log(`  free parser already caught: ${hits.filter((h) => h.freeCaught).length} | NEEDS YOUR REVIEW (HH text but parser missed): ${hits.filter((h) => !h.freeCaught).length}`);
    console.log(`  → ${out}\n`);
    console.log("Top venues with happy hour ON THEIR SITE that the free parser MISSED (your review list):");
    for (const h of hits.filter((x) => !x.freeCaught).slice(0, 20)) {
      console.log(`  • ${h.name}\n      ${h.url}\n      “${h.snippet.slice(0, 130)}”`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
