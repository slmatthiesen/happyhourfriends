/**
 * Runnable check: sitemap parsing + discovery. NO network — discoverSitemapUrls
 * takes an injected fetcher, so we feed a fake site (robots → sitemap index →
 * child sitemaps → locs) and assert the index is followed, bounds hold, and a
 * missing child is tolerated (best-effort, never throws).
 *
 * Run: tsx scripts/test-sitemap.ts
 */
import assert from "node:assert";
import { parseSitemapXml, sitemapsFromRobots, discoverSitemapUrls } from "@/lib/places/sitemap";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => { passed++; console.log(`  ✓ ${name}`); });
}

async function main() {
  await check("parseSitemapXml reads a urlset", () => {
    const xml = `<urlset><url><loc>https://x.com/a</loc></url><url><loc> https://x.com/b </loc></url></urlset>`;
    const r = parseSitemapXml(xml);
    assert.equal(r.kind, "urlset");
    assert.deepEqual(r.locs, ["https://x.com/a", "https://x.com/b"]);
  });

  await check("parseSitemapXml detects a sitemapindex", () => {
    const xml = `<sitemapindex><sitemap><loc>https://x.com/sm1.xml</loc></sitemap></sitemapindex>`;
    const r = parseSitemapXml(xml);
    assert.equal(r.kind, "index");
    assert.deepEqual(r.locs, ["https://x.com/sm1.xml"]);
  });

  await check("parseSitemapXml ignores non-http locs", () => {
    const xml = `<urlset><url><loc>ftp://x.com/a</loc></url><url><loc>https://x.com/b</loc></url></urlset>`;
    assert.deepEqual(parseSitemapXml(xml).locs, ["https://x.com/b"]);
  });

  await check("sitemapsFromRobots pulls Sitemap directives only", () => {
    const robots = "User-agent: *\nDisallow: /admin\nSitemap: https://x.com/sitemap_index.xml\nsitemap: https://x.com/news.xml";
    assert.deepEqual(sitemapsFromRobots(robots), ["https://x.com/sitemap_index.xml", "https://x.com/news.xml"]);
  });

  await check("discoverSitemapUrls follows robots → index → children, tolerates a missing child", async () => {
    const site: Record<string, string> = {
      "https://x.com/robots.txt": "Sitemap: https://x.com/sitemap_index.xml",
      "https://x.com/sitemap_index.xml": `<sitemapindex><sitemap><loc>https://x.com/sm-pages.xml</loc></sitemap><sitemap><loc>https://x.com/sm-gone.xml</loc></sitemap></sitemapindex>`,
      "https://x.com/sm-pages.xml": `<urlset><url><loc>https://x.com/happy-hour</loc></url><url><loc>https://x.com/about</loc></url></urlset>`,
      // sm-gone.xml intentionally absent → fetcher returns null
    };
    const fetcher = async (u: string) => site[u] ?? null;
    const urls = await discoverSitemapUrls("https://x.com", fetcher);
    assert.ok(urls.includes("https://x.com/happy-hour"), "found HH url via index");
    assert.ok(urls.includes("https://x.com/about"), "found other url");
    assert.equal(urls.length, 2, "exactly the two real urls");
  });

  await check("discoverSitemapUrls falls back to /sitemap.xml when robots has none", async () => {
    const site: Record<string, string> = {
      "https://y.com/sitemap.xml": `<urlset><url><loc>https://y.com/specials</loc></url></urlset>`,
    };
    const urls = await discoverSitemapUrls("https://y.com", async (u) => site[u] ?? null);
    assert.deepEqual(urls, ["https://y.com/specials"]);
  });

  await check("discoverSitemapUrls honors maxUrls", async () => {
    const locs = Array.from({ length: 10 }, (_, i) => `<url><loc>https://z.com/p${i}</loc></url>`).join("");
    const site: Record<string, string> = { "https://z.com/sitemap.xml": `<urlset>${locs}</urlset>` };
    const urls = await discoverSitemapUrls("https://z.com", async (u) => site[u] ?? null, { maxUrls: 3 });
    assert.equal(urls.length, 3);
  });

  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
