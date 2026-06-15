/**
 * Hermetic unit checks for the own-site happy-hour page probe (no network — the
 * fetcher is injected). Run: npx tsx scripts/test-own-site-hh-probe.ts
 *
 * Classifies a venue's OWN domain HH paths: 200 + HH text signal → 'readable';
 * 403 / anti-bot → 'blocked' (page exists, plain HTTP can't read it — extractor will
 * render); 404 / soft-404 / 200-without-signal → 'none'.
 */
import assert from "node:assert/strict";
import { probeOwnSiteHhPage } from "@/lib/places/ownSiteHhProbe";

let passed = 0;
function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  });
}

// A fetcher that maps exact URLs → responses; anything unmapped is a 404.
function fakeFetcher(map: Record<string, { status: number; body: string }>) {
  return async (url: string) => map[url] ?? { status: 404, body: "" };
}

const HH_BODY = "Join us for Happy Hour Mon–Fri 3pm–6pm — $5 wells, half-price apps.";

async function main() {
  await check("readable: /happy-hour returns 200 with HH signal", async () => {
    const r = await probeOwnSiteHhPage(
      "https://foo.com",
      fakeFetcher({ "https://foo.com/happy-hour": { status: 200, body: HH_BODY } }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://foo.com/happy-hour", status: "readable" });
  });

  await check("blocked: HH path 403s (anti-bot wall)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://bistro44.com",
      fakeFetcher({ "https://bistro44.com/happy-hour": { status: 403, body: "" } }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://bistro44.com/happy-hour", status: "blocked" });
  });

  await check("blocked: HH path 429s (rate-limited wall)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://foo.com",
      fakeFetcher({ "https://foo.com/happy-hour": { status: 429, body: "" } }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://foo.com/happy-hour", status: "blocked" });
  });

  await check("none: all paths 404", async () => {
    const r = await probeOwnSiteHhPage("https://foo.com", fakeFetcher({}));
    assert.deepEqual(r, { hhPageUrl: null, status: "none" });
  });

  await check("none: 200 but no HH signal (soft-404 / generic page)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://foo.com",
      fakeFetcher({ "https://foo.com/specials": { status: 200, body: "<h1>Welcome</h1>" } }),
    );
    assert.deepEqual(r, { hhPageUrl: null, status: "none" });
  });

  await check("readable wins over blocked when both exist (signal beats wall)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://foo.com",
      fakeFetcher({
        "https://foo.com/happy-hour": { status: 403, body: "" },
        "https://foo.com/specials": { status: 200, body: HH_BODY },
      }),
    );
    assert.equal(r.status, "readable");
    assert.equal(r.hhPageUrl, "https://foo.com/specials");
  });

  await check("null/garbage website → none, no fetch", async () => {
    assert.deepEqual(await probeOwnSiteHhPage(null, fakeFetcher({})), { hhPageUrl: null, status: "none" });
    assert.deepEqual(await probeOwnSiteHhPage("not a url", fakeFetcher({})), { hhPageUrl: null, status: "none" });
  });

  await check("Pass 2: discovers a LINKED HH page the guessed paths miss → readable", async () => {
    // guessed paths 404; the homepage links a non-guessed HH route that IS readable.
    const r = await probeOwnSiteHhPage(
      "https://spa.com",
      fakeFetcher({
        "https://spa.com": { status: 200, body: '<html><a href="/late-night/happy-hour">Happy Hour</a></html>' },
        "https://spa.com/late-night/happy-hour": { status: 200, body: HH_BODY },
      }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://spa.com/late-night/happy-hour", status: "readable" });
  });

  await check("Pass 2: declared HH route that's JS-walled (no readable signal) → blocked", async () => {
    const r = await probeOwnSiteHhPage(
      "https://jsshell.com",
      fakeFetcher({
        "https://jsshell.com": { status: 200, body: '<a href="/menu/late-happy-hour">Happy Hour</a>' },
        "https://jsshell.com/menu/late-happy-hour": { status: 200, body: '<div id="root"></div>' },
      }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://jsshell.com/menu/late-happy-hour", status: "blocked" });
  });

  await check("Pass 2: homepage bot-walls plain fetch → blocked (whole site, render needed)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://walled.com",
      fakeFetcher({ "https://walled.com": { status: 403, body: "" } }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://walled.com", status: "blocked" });
  });

  await check("non-own-site host (social / parent-hotel) → none, never probed", async () => {
    // instagram.com/happy-hour would 200 with generic content — must be skipped, not a false readable.
    const insta = await probeOwnSiteHhPage(
      "https://www.instagram.com/bayhorsetavern",
      fakeFetcher({ "https://www.instagram.com/happy-hour": { status: 200, body: HH_BODY } }),
    );
    assert.deepEqual(insta, { hhPageUrl: null, status: "none" });
    const hotel = await probeOwnSiteHhPage(
      "http://www3.hilton.com/en/hotels/arizona",
      fakeFetcher({ "http://www3.hilton.com/happy-hour": { status: 200, body: HH_BODY } }),
    );
    assert.deepEqual(hotel, { hhPageUrl: null, status: "none" });
  });

  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
