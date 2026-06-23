/**
 * $0-API scan: which bare-window venues (live HH, 0 offerings) embed a third-party MENU widget
 * the new extractMenuEmbedUrls fix recovers? Renders each venue's likely HH/menu pages with
 * headless Chromium (no model calls) and reports menu-widget-iframe hits by host + venue + city.
 * Run: pnpm tsx scripts/scan-menu-embeds.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { renderUrl, closeRenderBrowser } from "@/lib/verification/renderUrl";
import type { FetchResult } from "@/lib/verification/fetchUrl";
import { extractMenuEmbedUrls } from "@/lib/places/siteTriage";

const CANDIDATE_PATHS = ["/menus/happy-hour", "/happy-hour", "/menu"];

async function detect(base: string): Promise<{ url: string; host: string } | null> {
  let origin: string;
  try { origin = new URL(base).origin; } catch { return null; }
  for (const p of CANDIDATE_PATHS) {
    const u = origin + p;
    try {
      const r = await Promise.race<FetchResult>([
        renderUrl(u, { timeoutMs: 15000 }),
        new Promise<FetchResult>((res) => setTimeout(() => res({ url: u, ok: false }), 20000)),
      ]);
      if (!r?.ok) continue;
      // renderUrl already folds widget text into contentText; also re-detect the host name
      const txt: string = r.contentText || "";
      const m = txt.match(/Menu \(embedded from ([^)\n]+)\)/);
      if (m) return { url: r.url || u, host: m[1] };
    } catch { /* skip */ }
  }
  return null;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const venues = await sql<{ id: string; name: string; website_url: string | null; city: string; state: string }[]>`
    SELECT DISTINCT v.id, v.name, v.website_url, c.name AS city, c.state
    FROM happy_hours hh JOIN venues v ON v.id = hh.venue_id JOIN cities c ON c.id = v.city_id
    WHERE hh.active = true AND hh.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM offerings o WHERE o.happy_hour_id = hh.id)
      AND v.website_url IS NOT NULL
    ORDER BY c.name, v.name`;
  await sql.end();
  console.log(`Scanning ${venues.length} bare-window venues (with a website)…\n`);

  const hits: { name: string; city: string; host: string; url: string }[] = [];
  let done = 0;
  const CONC = 3;
  for (let i = 0; i < venues.length; i += CONC) {
    const batch = venues.slice(i, i + CONC);
    await Promise.all(batch.map(async (v) => {
      const hit = await detect(v.website_url!);
      done++;
      if (hit) {
        hits.push({ name: v.name, city: `${v.city}, ${v.state}`, host: hit.host, url: hit.url });
        console.log(`  [${done}/${venues.length}] ✓ HIT ${v.name} (${v.city}) → ${hit.host}`);
      } else {
        console.log(`  [${done}/${venues.length}]   ${v.name} (${v.city})`);
      }
    }));
  }
  await closeRenderBrowser();

  console.log(`\n══ RESULTS ══`);
  console.log(`menu-widget hits: ${hits.length}/${venues.length} bare-window venues`);
  const byHost: Record<string, number> = {};
  hits.forEach((h) => { const k = h.host.replace(/^[a-z]+\./, ""); byHost[k] = (byHost[k] || 0) + 1; });
  console.log(`by host:`, JSON.stringify(byHost));
  console.log(`\nrecoverable venues:`);
  hits.forEach((h) => console.log(`  ${h.name} — ${h.city} — ${h.host}`));
}
main();
