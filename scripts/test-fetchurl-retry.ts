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
 *  from a scripted list of responses-or-errors, last entry repeating once exhausted. The UA
 *  header of each target request is recorded so the bot-wall browser-UA fallback is observable. */
function fakeFetch(target: Array<Response | Error>, opts: { robotsTxt?: string } = {}) {
  const calls = { robots: 0, target: 0, targetUAs: [] as string[] };
  let i = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u.endsWith("/robots.txt")) {
      calls.robots++;
      return new Response(opts.robotsTxt ?? "", { status: opts.robotsTxt ? 200 : 404 });
    }
    calls.target++;
    const ua = (init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? "";
    calls.targetUAs.push(ua);
    const r = target[Math.min(i, target.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    // Response bodies are single-use; clone so a repeated last-entry stays readable.
    return r.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** A fake fetch whose target response depends on the request's User-Agent — models a CDN that
 *  bot-walls our honest UA but serves a real browser. `botResult` answers the HappyHourFriendsBot
 *  UA; `browserResult` answers anything else. robots.txt 404s (→ proceed optimistically). */
function uaGatedFetch(botResult: Response | Error, browserResult: Response | Error) {
  const calls = { robots: 0, target: 0, targetUAs: [] as string[] };
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u.endsWith("/robots.txt")) {
      calls.robots++;
      return new Response("", { status: 404 });
    }
    calls.target++;
    const ua = (init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? "";
    calls.targetUAs.push(ua);
    const r = ua.includes("HappyHourFriendsBot") ? botResult : browserResult;
    if (r instanceof Error) throw r;
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

await check("does NOT same-UA-retry a 403, but tries the browser-UA fallback once", async () => {
  const { impl, calls } = fakeFetch([html("forbidden", 403)]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403, "persistent 403 still returns 403 so render fallback can own it");
  assert.equal(calls.target, 2, "one bot-UA attempt + one browser-UA fallback, no same-UA retry");
  assert.match(calls.targetUAs[0], /HappyHourFriendsBot/, "first attempt uses the honest bot UA");
  assert.match(calls.targetUAs[1], /Mozilla\/5\.0/, "fallback attempt uses a browser UA");
});

await check("bot-wall fallback: 403 on bot UA, served on browser UA → recovers", async () => {
  const { impl, calls } = uaGatedFetch(
    html("forbidden", 403),
    html("<html><body><p>Happy Hour Mon-Fri 3-6pm $7 cocktails</p></body></html>"),
  );
  const r = await fetchUrl("https://akamai.test/menu", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, true, "browser UA should clear the bot wall");
  assert.match(r.contentText ?? "", /Happy Hour Mon-Fri 3-6pm/i);
  assert.equal(calls.target, 2, "bot UA (403) then browser UA (200)");
});

await check("bot-wall fallback recovers a PDF the render path can't fetch (Tommy Bahama case)", async () => {
  const pdfBytes = Buffer.from("%PDF-1.4 happy hour daily 3-6pm");
  const { impl, calls } = uaGatedFetch(
    Object.assign(new Error("ECONNRESET"), { name: "FetchError" }), // Akamai TLS reset of bot UA
    new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } }),
  );
  const r = await fetchUrl("https://cdn.test/Scottsdale_Dinner_Menu.pdf", {
    fetchImpl: impl,
    retryDelaysMs: NO_WAIT,
  });
  assert.equal(r.ok, true, "connection-reset bot wall is cleared by the browser UA");
  assert.equal(r.isPdf, true, "the recovered media parses as a PDF");
  // bot UA: initial + NO_WAIT retries (reset is a retryable thrown error); then ONE browser-UA call.
  assert.equal(calls.target, NO_WAIT.length + 1 + 1);
  assert.match(calls.targetUAs[calls.targetUAs.length - 1], /Mozilla\/5\.0/, "last attempt is browser UA");
});

await check("browser-UA fallback does NOT fire when the bot UA already succeeded", async () => {
  const { impl, calls } = fakeFetch([html("<html><body>ok</body></html>")]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, true);
  assert.equal(calls.target, 1, "success on bot UA must not trigger the fallback");
  assert.match(calls.targetUAs[0], /HappyHourFriendsBot/);
});

await check("browser-UA fallback does NOT fire on a 404 (not a bot wall)", async () => {
  const { impl, calls } = fakeFetch([html("nope", 404)]);
  const r = await fetchUrl("https://x.test/missing", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(calls.target, 1, "404 is terminal — no browser-UA fallback");
});

await check("exhausts retries on a persistent thrown error, then tries browser-UA, returns failure", async () => {
  const { impl, calls } = fakeFetch([
    Object.assign(new Error("ECONNRESET"), { name: "FetchError" }),
  ]);
  const r = await fetchUrl("https://x.test/", { fetchImpl: impl, retryDelaysMs: NO_WAIT });
  assert.equal(r.ok, false);
  // initial + each bot-UA retry, then one browser-UA fallback (a thrown error is a bot-wall signature).
  assert.equal(calls.target, NO_WAIT.length + 1 + 1, "bot-UA initial+retries, then one browser-UA attempt");
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
