/**
 * Runnable unit checks for the deterministic working-URL resolver (no DB/AI/network, $0).
 * The probe is injected, so these are hermetic. Run: pnpm tsx scripts/test-resolve-website-url.ts
 */
import assert from "node:assert/strict";
import type { ProbeOutcome } from "@/lib/places/siteHealth";
import { websiteUrlCandidates, resolveWorkingUrl } from "@/lib/places/resolveWebsiteUrl";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main() {

/** Mock probe: `oks[url]` present → HTTP 200 with that finalUrl (true = finalUrl is the url
 *  itself); any other url → dns_dead. */
const mockProbe =
  (oks: Record<string, string | true>) =>
  async (url: string): Promise<ProbeOutcome> => {
    if (url in oks) {
      const f = oks[url];
      return { finalUrl: typeof f === "string" ? f : url, status: 200, errorCode: null };
    }
    return { finalUrl: null, status: null, errorCode: "ENOTFOUND" };
  };

await check("candidates: toggles scheme+www, excludes the original, https first", () => {
  assert.deepEqual(websiteUrlCandidates("http://www.foo.com/"), [
    "https://www.foo.com/",
    "https://foo.com/",
    "http://foo.com/",
  ]);
});

await check("candidates: preserve path + query on every variant", () => {
  assert.deepEqual(websiteUrlCandidates("https://bar.com/a?b=1"), [
    "https://www.bar.com/a?b=1",
    "http://bar.com/a?b=1",
    "http://www.bar.com/a?b=1",
  ]);
});

await check("candidates: unparseable URL → []", () => {
  assert.deepEqual(websiteUrlCandidates("not a url"), []);
});

await check("resolve: ALTNAME-style fix — cert valid on www, stored apex (Tutti Santi)", async () => {
  const r = await resolveWorkingUrl(
    "http://tuttisantiphoenix.com/",
    mockProbe({ "https://www.tuttisantiphoenix.com/": true }),
  );
  assert.equal(r.suggestedUrl, "https://www.tuttisantiphoenix.com/");
});

await check("resolve: prefers the post-redirect final URL (http→https canonical)", async () => {
  const r = await resolveWorkingUrl(
    "https://www.south.com/",
    mockProbe({ "http://south.com/": "https://south.com/" }),
  );
  assert.equal(r.suggestedUrl, "https://south.com/");
});

await check("resolve: no working variant → null", async () => {
  const r = await resolveWorkingUrl("https://dead.example/", mockProbe({}));
  assert.equal(r.suggestedUrl, null);
});

await check("resolve: never suggests a denylisted redirect target (aggregator)", async () => {
  const r = await resolveWorkingUrl(
    "http://foo.com/",
    mockProbe({ "https://foo.com/": "https://www.sirved.com/menu/foo" }),
  );
  assert.equal(r.suggestedUrl, null);
});

  console.log(`\n✓ resolve-website-url: ${passed} checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
