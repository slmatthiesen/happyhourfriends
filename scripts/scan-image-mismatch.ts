/**
 * $0 scan: which bare-window venues feed an image whose declared type (URL ext / content-type)
 * disagrees with its magic bytes — the mismatch that 400'd the whole extraction before the
 * sniff fix. Replays triage+fetch (no model). Run: pnpm tsx scripts/scan-image-mismatch.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { fetchPages } from "@/lib/ai/siteContent";
import { sniffImageMediaType } from "@/lib/verification/fetchUrl";
import { loadRenderUrl } from "@/lib/verification/lazyRender";
import { closeRenderBrowserSafe } from "@/lib/verification/lazyRender";

function declaredByExt(u: string): string | null {
  const ext = new URL(u).pathname.toLowerCase().match(/\.(jpe?g|png|gif|webp)(?:$|\?)/)?.[1];
  if (!ext) return null;
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const venues = await sql<{ id: string; name: string; website_url: string; type: string | null; city: string }[]>`
    SELECT DISTINCT v.id, v.name, v.website_url, v.type AS type, c.name AS city
    FROM happy_hours hh JOIN venues v ON v.id=hh.venue_id JOIN cities c ON c.id=v.city_id
    WHERE hh.active=true AND hh.deleted_at IS NULL AND v.website_url IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM offerings o WHERE o.happy_hour_id=hh.id)
    ORDER BY c.name, v.name`;
  await sql.end();
  const render = await loadRenderUrl().catch(() => undefined);
  console.log(`Scanning ${venues.length} bare venues for image media-type mismatch…\n`);

  let withImage = 0, mismatch = 0, done = 0;
  const hits: string[] = [];
  for (const v of venues) {
    done++;
    try {
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: null, primaryType: v.type, types: null });
      if (verdict.kind !== "real") continue;
      const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: v.type, types: null, name: v.name }));
      if (decided.action !== "extract") continue;
      const pages = await fetchPages([verdict.url, ...(decided.priorityUrls ?? [])], 8, { maxContent: 28000, render });
      const imgs = pages.filter((p: any) => p.imageBase64);
      if (imgs.length === 0) continue;
      withImage++;
      // would any have 400'd? compare what the URL-ext WOULD declare vs the real sniffed bytes
      let bad = false;
      for (const im of imgs as any[]) {
        const declared = declaredByExt(im.url);
        const actual = sniffImageMediaType(Buffer.from(im.imageBase64, "base64"));
        if (declared && actual && declared !== actual) bad = true;
      }
      if (bad) { mismatch++; hits.push(`${v.name} (${v.city})`); console.log(`  [${done}/${venues.length}] ⚠ MISMATCH ${v.name} (${v.city})`); }
    } catch { /* skip */ }
  }
  await closeRenderBrowserSafe();
  console.log(`\n══ RESULTS ══`);
  console.log(`venues feeding ≥1 image:        ${withImage}`);
  console.log(`…with a media-type MISMATCH (would 400 pre-fix): ${mismatch}`);
  hits.forEach((h) => console.log(`  ${h}`));
}
main();
