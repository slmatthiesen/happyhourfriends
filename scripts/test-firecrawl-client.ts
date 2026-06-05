/**
 * Hermetic unit test for the Firecrawl render-backend client. Mocks global fetch; no
 * network, no Docker. Run: tsx scripts/test-firecrawl-client.ts
 */
import assert from "node:assert";
import { scrapeWithFirecrawl } from "@/lib/places/firecrawl";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => { passed++; console.log(`  ✓ ${name}`); });
}

const realFetch = globalThis.fetch;
const realEnv = process.env.FIRECRAWL_URL;
function mockFetch(impl: typeof globalThis.fetch) { globalThis.fetch = impl; }
function restore() { globalThis.fetch = realFetch; process.env.FIRECRAWL_URL = realEnv; }

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

async function main() {
  await check("returns null when FIRECRAWL_URL is unset", async () => {
    delete process.env.FIRECRAWL_URL;
    let called = false;
    mockFetch(async () => { called = true; return jsonResponse({}); });
    const r = await scrapeWithFirecrawl("https://venue.example/menu");
    assert.equal(r, null);
    assert.equal(called, false, "must not call fetch when unconfigured");
  });

  await check("returns null for a PDF/image URL without calling fetch", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    let called = false;
    mockFetch(async () => { called = true; return jsonResponse({}); });
    assert.equal(await scrapeWithFirecrawl("https://venue.example/menu.pdf"), null);
    assert.equal(await scrapeWithFirecrawl("https://venue.example/flyer.JPG"), null);
    assert.equal(called, false, "PDF/image URLs skip Firecrawl");
  });

  await check("maps a successful scrape to a FetchResult", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    mockFetch(async () => jsonResponse({
      success: true,
      data: {
        markdown: "Happy Hour Mon-Fri 4-6pm $5 wells",
        html: '<a href="/menus/hh.pdf">Happy Hour Menu</a>',
        links: ["https://venue.example/menus/hh.pdf"],
        metadata: { url: "https://venue.example/menu", statusCode: 200, contentType: "text/html" },
      },
    }));
    const r = await scrapeWithFirecrawl("https://venue.example/menu");
    assert.ok(r && r.ok, "ok result");
    assert.equal(r!.url, "https://venue.example/menu");
    assert.equal(r!.status, 200, "maps statusCode");
    assert.match(r!.contentText ?? "", /Happy Hour Mon-Fri/);
    assert.ok((r!.mediaLinks ?? []).some((m) => /hh\.pdf$/.test(m)), "surfaces the PDF link");
  });

  await check("returns null when Firecrawl reports a PDF content-type (redirect to doc)", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    mockFetch(async () => jsonResponse({
      success: true,
      data: { markdown: "garbled pdf text", metadata: { url: "https://venue.example/x", contentType: "application/pdf" } },
    }));
    assert.equal(await scrapeWithFirecrawl("https://venue.example/qr"), null);
  });

  await check("returns null on HTTP error, empty markdown, or thrown fetch", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    mockFetch(async () => jsonResponse({}, false));
    assert.equal(await scrapeWithFirecrawl("https://venue.example/a"), null, "http !ok");
    mockFetch(async () => jsonResponse({ success: true, data: { markdown: "  ", metadata: {} } }));
    assert.equal(await scrapeWithFirecrawl("https://venue.example/b"), null, "empty markdown");
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    assert.equal(await scrapeWithFirecrawl("https://venue.example/c"), null, "thrown");
  });

  restore();
  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => { restore(); console.error(e); process.exit(1); });
