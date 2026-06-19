/**
 * Runnable unit checks for fetchUrl's transient-failure retry (no test framework in repo).
 * Run: pnpm tsx scripts/test-fetchurl-retry.ts — exits non-zero on any failure.
 *
 * Guards the fetch-reliability fix: media/discovered-page fetches were dropping ~1/3 of
 * runs to a whole-venue 0% (CDN timeout / connection reset / 5xx — nondeterministic). The
 * eval signature was "every flaky golden fails as a whole-venue 0% run (media not fetched
 * that run)" — i.e. a transient network failure with NO retry silently lost the deal source.
 * fetchUrl now retries transient failures (thrown network/timeout errors + 5xx/408/425)
 * with backoff, and does NOT retry terminal results (404, bot walls, too-large, robots).
 */
import assert from "node:assert/strict";
import { fetchUrl } from "@/lib/verification/fetchUrl";

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const NO_WAIT = [0, 0]; // 2 retries, no real backoff sleep

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

/** A fake fetch: robots.txt always 404s (→ proceed optimistically); target URL is served
 *  from a scripted list of responses-or-errors, last entry repeating once exhausted. */
function fakeFetch(target: Array<Response | Error>, opts: { robotsTxt?: string } = {}) {
  const calls = { robots: 0, target: 0 };
  let i = 0;
  const impl = (async (input: string | URL | Request) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u.endsWith("/robots.txt")) {
      calls.robots++;
      return new Response(opts.robotsTxt ?? "", { status: opts.robotsTxt ? 200 : 404 });
    }
    calls.target++;
    const r = target[Math.min(i, target.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    // Response bodies are single-use; clone so a repeated last-entry stays readable.
    return r.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function main() {
await check("retries a thrown network error, then succeeds", async () => {
  const { impl, calls } = fakeFetch([
    Object.assign(new Error("socket hang up"), { name: "FetchError" }),
    html("<html><body><p>Happy Hour 4-6pm $5 beers</p></body></html>"),
  ]);
  const r = await fetchUrl("https://x.test/menu", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, true, "should recover after one transient failure");
  assert.match(r.contentText ?? "", /Happy Hour 4-6pm/i);
  assert.equal(calls.target, 2, "should have retried exactly once");
});

await check("retries an AbortError (timeout), then succeeds", async () => {
  const { impl, calls } = fakeFetch([
    Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    html("<html><body>$8 cocktails daily</body></html>"),
  ]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, true);
  assert.equal(calls.target, 2);
});

await check("retries a 503, then succeeds", async () => {
  const { impl, calls } = fakeFetch([html("", 503), html("<html><body>ok</body></html>")]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, true);
  assert.equal(calls.target, 2);
});

await check("does NOT retry a 404 (terminal)", async () => {
  const { impl, calls } = fakeFetch([html("not found", 404)]);
  const r = await fetchUrl("https://x.test/missing", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(calls.target, 1, "404 must not be retried");
});

await check("does NOT retry a bot wall (403 → render fallback owns it)", async () => {
  const { impl, calls } = fakeFetch([html("forbidden", 403)]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(calls.target, 1, "403 bot wall must go straight to the render path, not retry");
});

await check("exhausts retries on a persistent transient error, returns failure", async () => {
  const { impl, calls } = fakeFetch([
    Object.assign(new Error("ECONNRESET"), { name: "FetchError" }),
  ]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, false);
  assert.equal(calls.target, NO_WAIT.length + 1, "should try initial + each retry, then give up");
});

await check("does NOT retry when the first attempt succeeds", async () => {
  const { impl, calls } = fakeFetch([html("<html><body>fine</body></html>")]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, true);
  assert.equal(calls.target, 1);
});

await check("recovers a PDF (image/PDF media) after a transient failure", async () => {
  const pdfBytes = Buffer.from("%PDF-1.4 happy hour menu");
  const pdfRes = new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } });
  const { impl, calls } = fakeFetch([
    Object.assign(new Error("CDN timeout"), { name: "AbortError" }),
    pdfRes,
  ]);
  const r = await fetchUrl("https://cdn.test/hh-menu.pdf", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, true);
  assert.equal(r.isPdf, true, "the recovered media should parse as a PDF");
  assert.equal(calls.target, 2);
});

console.log(`\n${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
