/**
 * $0 diagnostic — quantify how many bare-window venues (live window + 0 offerings) hide their
 * happy-hour menu behind a Squarespace BUTTON BLOCK clickthrough that extractMediaLinks can't
 * see. Fate Brewing's HH PDF was linked as {"clickthroughUrl":{"url":"/s/Fate-Happy-Hour-Menu"}}
 * — not an <a>/<img>/ld+json, and extensionless — so discovery never found it.
 *
 * Run: pnpm tsx scripts/scan-squarespace-clickthrough.ts
 * Pure HTTP (no API, no model). Reads DATABASE_URL.
 */
import "dotenv/config";
import postgres from "postgres";

const BOT_UA = "HappyHourFriendsBot/1.0 (+https://happyhourfriends.com)";
const HH_MENU = /happy[\s+_-]?hour|\bmenu\b|\bspecials?\b|drink|cocktail|aperitivo|vermut|hora[\s+_-]?feliz/i;

type Cause =
  | "squarespace-hh-clickthrough" // the Fate pattern — high-yield recoverable
  | "squarespace-other"
  | "non-squarespace"
  | "no-website"
  | "fetch-failed";

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": BOT_UA } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Does this homepage carry a Squarespace clickthrough/anchor to an (extensionless) menu asset
 *  whose slug or nearby label has an HH/menu signal? Returns the matched target for evidence. */
function findHhClickthrough(html: string): string | null {
  // Squarespace button block: {"clickthroughUrl":{"url":"/s/Foo-Happy-Hour-Menu"}}
  const ctRe = /"clickthroughUrl"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = ctRe.exec(html)) !== null) {
    const u = m[1];
    // /s/ shortlinks and static1 /t/ assets are Squarespace file redirects; an .pdf/.jpg target
    // would already be caught by extractMediaLinks, so the GAP is the extensionless ones.
    const isFileLink = /^\/s\//i.test(u) || /static1\.squarespace\.com\/static\/[a-f0-9]+\/t\//i.test(u);
    if (!isFileLink) continue;
    const hasExt = /\.(pdf|jpe?g|png|webp|gif)(\?|#|$)/i.test(u);
    if (hasExt) continue; // already discoverable today
    // Signal: the slug itself, OR the ~140 chars of button text just before it.
    const ctx = html.slice(Math.max(0, m.index - 140), m.index);
    if (HH_MENU.test(u) || HH_MENU.test(ctx)) return u;
  }
  // Plain anchor to an extensionless /s/ link with an HH/menu slug (non-JS Squarespace pages).
  const aRe = /href\s*=\s*["'](\/s\/[^"']+)["']/gi;
  while ((m = aRe.exec(html)) !== null) {
    const u = m[1];
    if (/\.(pdf|jpe?g|png|webp|gif)(\?|#|$)/i.test(u)) continue;
    if (HH_MENU.test(u)) return u;
  }
  return null;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const bare = await sql<{ name: string; website_url: string | null; city: string }[]>`
      SELECT v.name, v.website_url, c.name AS city
      FROM venues v
      JOIN cities c ON c.id = v.city_id AND c.status = 'live'
      JOIN happy_hours h ON h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
      WHERE v.status = 'active' AND v.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h2
          JOIN offerings o ON o.happy_hour_id = h2.id AND o.active = true AND o.deleted_at IS NULL
          WHERE h2.venue_id = v.id AND h2.active = true AND h2.deleted_at IS NULL
        )
      GROUP BY v.id, v.name, v.website_url, c.name
      ORDER BY c.name, v.name`;

    console.log(`Scanning ${bare.length} bare-window venue(s) across live cities…\n`);

    const results: { name: string; city: string; cause: Cause; evidence?: string }[] = [];
    const CONCURRENCY = 8;
    for (let i = 0; i < bare.length; i += CONCURRENCY) {
      const batch = bare.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        batch.map(async (v) => {
          if (!v.website_url) return { name: v.name, city: v.city, cause: "no-website" as Cause };
          const html = await fetchRaw(v.website_url);
          if (html == null) return { name: v.name, city: v.city, cause: "fetch-failed" as Cause };
          const isSquarespace = /squarespace|static1\.squarespace\.com/i.test(html);
          const hit = findHhClickthrough(html);
          if (hit) return { name: v.name, city: v.city, cause: "squarespace-hh-clickthrough" as Cause, evidence: hit };
          return { name: v.name, city: v.city, cause: (isSquarespace ? "squarespace-other" : "non-squarespace") as Cause };
        }),
      );
      results.push(...settled);
      process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, bare.length)}/${bare.length}`.padEnd(20));
    }
    process.stdout.write("\n\n");

    const by = (c: Cause) => results.filter((r) => r.cause === c);
    const hh = by("squarespace-hh-clickthrough");
    console.log("── Squarespace clickthrough scan ─────────────────────────");
    console.log(`  ${String(bare.length).padStart(3)}  bare-window venues total`);
    console.log(`  ${String(hh.length).padStart(3)}  SQUARESPACE HH-CLICKTHROUGH (the Fate gap — recoverable by an extractMediaLinks fix)`);
    console.log(`  ${String(by("squarespace-other").length).padStart(3)}  squarespace, no HH clickthrough`);
    console.log(`  ${String(by("non-squarespace").length).padStart(3)}  non-squarespace`);
    console.log(`  ${String(by("no-website").length).padStart(3)}  no website on file`);
    console.log(`  ${String(by("fetch-failed").length).padStart(3)}  fetch failed`);

    if (hh.length) {
      console.log(`\n── recoverable HH-clickthrough venues (${hh.length}) ──`);
      for (const r of hh) console.log(`  ${(r.city + " · " + r.name).slice(0, 50).padEnd(50)} → ${r.evidence}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
