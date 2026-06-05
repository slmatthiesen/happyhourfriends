/**
 * Hermetic test: when FIRECRAWL_URL is set and Firecrawl returns content, renderUrl returns
 * the Firecrawl FetchResult WITHOUT launching Chromium (the Firecrawl path short-circuits
 * before getBrowser). Mocks global fetch. Run: tsx scripts/test-render-firecrawl.ts
 */
import assert from "node:assert";
import { renderUrl } from "@/lib/verification/renderUrl";

let passed = 0;
function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => { passed++; console.log(`  ✓ ${name}`); });
}

const realFetch = globalThis.fetch;
const realEnv = process.env.FIRECRAWL_URL;

async function main() {
  await check("renderUrl prefers Firecrawl when configured", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "Happy Hour daily 3-6pm",
          html: '<a href="/menu.pdf">menu</a>',
          metadata: { url: "https://venue.example/", statusCode: 200, contentType: "text/html" },
        },
      }),
    })) as unknown as typeof globalThis.fetch;

    const r = await renderUrl("https://venue.example/");
    assert.ok(r.ok, "ok");
    assert.match(r.contentText ?? "", /Happy Hour daily 3-6pm/, "uses Firecrawl content");
  });

  globalThis.fetch = realFetch;
  process.env.FIRECRAWL_URL = realEnv;
  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => {
  globalThis.fetch = realFetch;
  process.env.FIRECRAWL_URL = realEnv;
  console.error(e);
  process.exit(1);
});
