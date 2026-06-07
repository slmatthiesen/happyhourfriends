/**
 * spotcheck-free — inspect what the FREE parser WOULD do for a city, with evidence, so you
 * can eyeball precision before `reextract:stubs:free --apply`. READ-ONLY, $0, no writes.
 *
 *   LIVE   = windows that would be shown publicly (clean + plausible)
 *   REVIEW = captured hidden for operator review (clean + implausible)
 *
 * For each LIVE window it prints the source URL and the evidence snippet, so you can confirm
 * the "happy hour" is real and next to the time (not menu/operating hours).
 *
 * Usage: pnpm tsx scripts/spotcheck-free.ts --city <slug> --state <code> [--limit N] [--show-review]
 */
import "dotenv/config";
import postgres from "postgres";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";
import { parseHappyHours, type ParsedWindow } from "@/lib/places/parseHhText";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

function arg(f: string) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; }
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const SHOW_REVIEW = process.argv.includes("--show-review");

const fmt = (w: ParsedWindow) => `[${w.daysOfWeek.join(",")}] ${w.startTime ?? "open"}-${w.endTime ?? "close"}`;

async function main() {
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 6 });
  try {
    const city = await resolveCity(sql, slug, state);
    const stubs = await sql<{ id: string; name: string; website_url: string | null; primary_type: string | null }[]>`
      SELECT v.id, v.name, v.website_url, sc.primary_type
      FROM venues v LEFT JOIN seed_candidates sc ON sc.resulting_venue_id = v.id
      WHERE v.city_id = ${city.id} AND v.status='active' AND v.data_completeness='stub' AND v.website_url IS NOT NULL
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(`[SPOTCHECK] ${stubs.length} stub(s) with a website in ${city.name}. Read-only, $0.\n`);
    let liveVenues = 0, liveWindows = 0, reviewWindows = 0;

    for (const v of stubs) {
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: v.primary_type, types: null, name: v.name }));
      if (decided.action !== "extract") continue;
      let built;
      try {
        built = await buildExtractRequest({
          venueName: v.name, websiteUrl: verdict.kind === "real" ? verdict.url : null,
          otherUrl: null, cityName: city.name, priorityUrls: decided.priorityUrls, noRender: true,
        });
      } catch { continue; }

      const seen = new Set<string>();
      const live: ParsedWindow[] = [];
      const review: ParsedWindow[] = [];
      for (const p of built.pages) {
        for (const w of parseHappyHours(p.text ?? "", p.url)) {
          if (w.confidence !== "clean") continue;
          const key = `${w.daysOfWeek.join(",")}|${w.startTime}|${w.endTime}`;
          if (seen.has(key)) continue; seen.add(key);
          (w.plausible ? live : review).push(w);
        }
      }
      if (live.length) {
        liveVenues++; liveWindows += live.length;
        console.log(`✓ ${v.name}`);
        for (const w of live) {
          console.log(`    LIVE ${fmt(w)}  ${w.sourceUrl}`);
          console.log(`         “${w.evidence.replace(/\s+/g, " ").trim().slice(0, 160)}”`);
        }
        if (SHOW_REVIEW) for (const w of review) console.log(`    review ${fmt(w)}`);
      }
      reviewWindows += review.length;
    }

    console.log(`\n── Spotcheck summary ──`);
    console.log(`  venues with LIVE windows: ${liveVenues}`);
    console.log(`  LIVE windows (would show): ${liveWindows}`);
    console.log(`  REVIEW windows (hidden):   ${reviewWindows}${SHOW_REVIEW ? "" : "  (use --show-review to list)"}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
