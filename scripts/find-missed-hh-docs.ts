/**
 * find-missed-hh-docs — $0 finder for backfill candidates: venues we currently show as
 * stubs / bare windows that link an OBVIOUS happy-hour menu doc (PDF/image) on their own
 * site. Pure discovery — plain HTTP fetch + our own parsers, NO Anthropic calls, NO DB
 * writes. The output is a ranked worklist; re-extracting a flagged venue (paid) is a
 * separate, opt-in step.
 *
 * Signal tiers (highest first):
 *   hh_anchor — the page links a doc under a "Happy Hour" anchor (hhContextMediaLinks).
 *               Strongest: the page itself labels the doc as the happy hour (Lucky Silver).
 *   hh_named  — a linked doc's filename/path scores as happy-hour (scoreHhUrl ≥ 70).
 *   any_doc   — some linked menu PDF/image exists (weaker; may be food/drink only).
 *
 * Usage:
 *   pnpm tsx scripts/find-missed-hh-docs.ts --sample 40            # estimate the hit rate
 *   pnpm tsx scripts/find-missed-hh-docs.ts --all --out tmp/x.csv  # full worklist → CSV
 *   flags: --bare (include bare-window venues), --city <slug> --state <st> (scope)
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { triageSite } from "@/lib/places/siteTriage";
import { fetchUrl } from "@/lib/verification/fetchUrl";
import { fetchUrlKey } from "@/lib/ai/siteContent";
import { scoreHhUrl } from "@/lib/places/hhText";
import { resolveCity } from "@/lib/cities/resolveCity";
import { mapWithConcurrency } from "@/lib/async/mapWithConcurrency";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (f: string) => process.argv.includes(f);

type Tier = "hh_anchor" | "hh_named" | "any_doc" | "none";

interface Candidate {
  id: string;
  name: string;
  website_url: string;
  type: string | null;
  city: string;
  state: string;
}

interface Hit {
  name: string;
  city: string;
  state: string;
  website: string;
  tier: Tier;
  docUrl: string;
}

async function scanVenue(v: Candidate): Promise<{ tier: Tier; docUrl: string; reached: boolean }> {
  const verdict = await triageSite({
    websiteUri: v.website_url,
    name: v.name,
    cityName: null,
    primaryType: v.type,
    types: null,
  });
  if (verdict.kind !== "real" || !verdict.url) return { tier: "none", docUrl: "", reached: false };
  const cand = [verdict.url, ...verdict.hhSignalUrls].slice(0, 8);
  const seen = new Set<string>();
  let reached = false;
  let best: { tier: Tier; docUrl: string } = { tier: "none", docUrl: "" };
  for (const u of cand) {
    const k = fetchUrlKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    const r = await fetchUrl(u, { maxContent: 2000 }).catch(() => null);
    if (!r || !r.ok) continue;
    reached = true;
    const hhAnchored = r.hhContextMediaLinks ?? [];
    if (hhAnchored.length > 0) return { tier: "hh_anchor", docUrl: hhAnchored[0], reached: true };
    const named = (r.mediaLinks ?? []).find((m) => scoreHhUrl(m) >= 70);
    if (named && best.tier === "none") best = { tier: "hh_named", docUrl: named };
    else if ((r.mediaLinks?.length ?? 0) > 0 && best.tier === "none") best = { tier: "any_doc", docUrl: r.mediaLinks![0] };
  }
  return { ...best, reached };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const sample = arg("--sample") ? Number(arg("--sample")) : undefined;
  const includeBare = has("--bare");
  const citySlug = arg("--city");
  const state = arg("--state");

  let cityId: string | null = null;
  if (citySlug && state) cityId = (await resolveCity(sql, citySlug, state)).id;

  // Stubs (no active HH) — always. Bare-window venues (HH window, zero offerings) — with --bare.
  const rows = await sql<Candidate[]>`
    SELECT v.id, v.name, v.website_url, v.type, c.slug AS city, c.state
    FROM venues v
    JOIN cities c ON c.id = v.city_id
    WHERE v.deleted_at IS NULL AND v.website_url IS NOT NULL
      ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
      AND (
        NOT EXISTS (SELECT 1 FROM happy_hours h WHERE h.venue_id=v.id AND h.active AND h.deleted_at IS NULL)
        ${includeBare ? sql`OR NOT EXISTS (
          SELECT 1 FROM happy_hours h JOIN offerings o ON o.happy_hour_id=h.id
          WHERE h.venue_id=v.id AND h.active AND h.deleted_at IS NULL)` : sql``}
      )
    ORDER BY ${sample ? sql`random()` : sql`v.name`}
    ${sample ? sql`LIMIT ${sample}` : sql``}`;
  await sql.end();

  const hits: Hit[] = [];
  const counts: Record<Tier, number> = { hh_anchor: 0, hh_named: 0, any_doc: 0, none: 0 };
  let reached = 0;
  let done = 0;
  const out = arg("--out");
  // Each venue is a distinct host, so scan many in parallel (the per-venue page fetches are
  // throttled inside scanVenue). Flush the CSV every batch so a timeout never loses progress.
  const flush = () => {
    if (!out) return;
    mkdirSync(dirname(out), { recursive: true });
    const sorted = [...hits].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "hh_anchor" ? -1 : 1));
    writeFileSync(out, ["name,city,state,website,tier,doc_url", ...sorted.map((h) => `${JSON.stringify(h.name)},${h.city},${h.state},${h.website},${h.tier},${h.docUrl}`)].join("\n"));
  };
  await mapWithConcurrency(rows, 8, async (v) => {
    try {
      const { tier, docUrl, reached: ok } = await scanVenue(v);
      if (ok) reached++;
      counts[tier]++;
      if (tier === "hh_anchor" || tier === "hh_named") hits.push({ name: v.name, city: v.city, state: v.state, website: v.website_url, tier, docUrl });
    } catch {
      counts.none++;
    }
    if (++done % 25 === 0) { console.error(`  …${done}/${rows.length} (${hits.length} flagged)`); flush(); }
  });

  // Strongest tier first.
  hits.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "hh_anchor" ? -1 : 1));

  console.error(`\n── scanned ${rows.length} venues (reached ${reached}) ──`);
  console.error(`  hh_anchor (page labeled the doc "Happy Hour"): ${counts.hh_anchor}`);
  console.error(`  hh_named  (doc filename scores as happy-hour):  ${counts.hh_named}`);
  console.error(`  any_doc   (some menu PDF/img, weaker):          ${counts.any_doc}`);
  const strong = counts.hh_anchor + counts.hh_named;
  console.error(`  → ${strong}/${rows.length} = ${((100 * strong) / rows.length).toFixed(0)}% high-confidence backfill candidates`);

  if (out) {
    flush();
    console.error(`\nwrote ${hits.length} candidates → ${out}`);
  } else {
    console.error(`\nflagged:`);
    hits.forEach((h) => console.error(`  ${h.tier === "hh_anchor" ? "★" : " "} [${h.tier}] ${h.name} (${h.city}, ${h.state})  ${h.docUrl}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
