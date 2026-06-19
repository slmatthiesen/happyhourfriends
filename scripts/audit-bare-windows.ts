/**
 * audit-bare-windows — $0 detector for the "dropped deals" backlog.
 *
 * A venue with ≥1 LIVE happy-hour window but ZERO offerings is usually fine: a bare time
 * pulled from its own site ("Mon–Fri 3–6pm") is valid, confirmed info. But some of those
 * windows are a RECALL MISS — the page actually listed prices/deals (or carried a menu
 * PDF/image) and the shallow free parser captured only the time. This script finds the
 * latter: bare-window venues whose site STILL shows deal/price content today.
 *
 * It replays the free pipeline up to (but never including) the model call — triageSite()
 * then fetchPages() — and keeps only venues where pagesShowDroppedDeals() fires. Legit
 * time-only listings are excluded so the heal never re-touches good data. Free: no Anthropic
 * call, no DB writes.
 *
 * The JSON report is the input list for the paid heal: `reextract:stubs --bare` (or run that
 * directly, which re-derives the same filter). Add this to the enrich/onboard runbook so the
 * backlog is never invisible.
 *
 * Usage: tsx scripts/audit-bare-windows.ts --city santa-barbara --state ca [--limit N]
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { triageSite } from "@/lib/places/siteTriage";
import { fetchPages, pagesShowDroppedDeals } from "@/lib/ai/siteContent";
import { hasPriceOrDealSignal } from "@/lib/places/hhText";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

/** Where the dropped deal is hiding — tells the operator what kind of fix the heal needs. */
type Cause = "pdf" | "image" | "text" | "none";

interface BareVenue {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  type: string | null;
}

interface Row {
  id: string;
  name: string;
  website: string | null;
  windows: number;
  cause: Cause;
  pagesFetched: number;
  evidence: string | null; // the price/deal substring that tripped the text signal, if any
}

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
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function classify(v: BareVenue & { windows: number }): Promise<Row> {
  const base: Row = {
    id: v.id,
    name: v.name,
    website: v.website_url,
    windows: v.windows,
    cause: "none",
    pagesFetched: 0,
    evidence: null,
  };
  if (!v.website_url) return base;

  const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: null });
  if (verdict.kind === "social_only" || verdict.decision === "kill") return base;

  const pages = await fetchPages([...verdict.hhSignalUrls, verdict.url], 5);
  base.pagesFetched = pages.length;
  if (!pagesShowDroppedDeals(pages)) return base; // legitimately time-only → leave it alone

  // Tag the strongest evidence: a menu doc we can't read free, else a priced text page.
  if (pages.some((p) => p.pdfBase64)) base.cause = "pdf";
  else if (pages.some((p) => p.imageBase64)) base.cause = "image";
  else base.cause = "text";
  for (const p of pages) {
    if (typeof p.text === "string" && hasPriceOrDealSignal(p.text)) {
      base.evidence = (p.text.match(/\$\s?\d[\d.,]*/) ?? [])[0] ?? "deal-words";
      break;
    }
  }
  return base;
}

async function main() {
  const args = parseArgs();
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const city = await resolveCity(sql, slug, state);

    // Venues with ≥1 active window but NO active offering on any of them — the bare-window set.
    const bare = await sql<(BareVenue & { windows: number })[]>`
      SELECT v.id, v.name, v.slug, v.website_url, v.type::text AS type,
             COUNT(*)::int AS windows
      FROM venues v
      JOIN happy_hours h
        ON h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
      WHERE v.city_id = ${city.id}
        AND v.status = 'active'
        AND v.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h2
          JOIN offerings o ON o.happy_hour_id = h2.id AND o.active = true AND o.deleted_at IS NULL
          WHERE h2.venue_id = v.id AND h2.active = true AND h2.deleted_at IS NULL
        )
      GROUP BY v.id, v.name, v.slug, v.website_url, v.type
      ORDER BY v.name
      ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
    `;

    console.log(`Scanning ${bare.length} bare-window venue(s) in ${city.name} for dropped deals…\n`);
    const rows = await pool(bare, 8, async (v, i) => {
      const r = await classify(v);
      process.stdout.write(`\r  [${i + 1}/${bare.length}] ${r.cause.padEnd(5)} ${r.name.slice(0, 44)}`.padEnd(80));
      return r;
    });
    process.stdout.write("\n\n");

    const dropped = rows.filter((r) => r.cause !== "none");
    const byCause = (c: Cause) => dropped.filter((r) => r.cause === c).length;

    console.log("── bare-window audit ─────────────────────────────────────");
    console.log(`  ${String(bare.length).padStart(3)}  bare-window venues (active window, 0 offerings)`);
    console.log(`  ${String(dropped.length).padStart(3)}  DROPPED DEALS — site still shows price/deal content (heal these)`);
    console.log(`        pdf=${byCause("pdf")}  image=${byCause("image")}  text=${byCause("text")}`);
    console.log(`  ${String(bare.length - dropped.length).padStart(3)}  legitimately time-only (leave alone)`);

    if (dropped.length) {
      console.log(`\n── dropped-deals list (${dropped.length}) ──`);
      for (const r of dropped) {
        console.log(
          `  ${r.name.slice(0, 36).padEnd(36)} ${r.cause.padEnd(5)} ` +
            `win=${r.windows} ${r.evidence ? `“${r.evidence}” ` : ""}${r.website ?? ""}`,
        );
      }
    }

    const reportPath = `docs/${slug}-bare-windows-${new Date().toISOString().slice(0, 10)}.json`;
    await writeFile(reportPath, JSON.stringify({ city: city.name, slug, dropped }, null, 2), "utf8");
    console.log(`\nHeal list (venue ids) → ${reportPath}`);
    console.log(`Then: pnpm reextract:stubs --city ${slug} --state ${state} --bare --dry-run   (then --bare to spend)`);
  } finally {
    await (await import("@/lib/verification/renderUrl")).closeRenderBrowser().catch(() => {});
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
