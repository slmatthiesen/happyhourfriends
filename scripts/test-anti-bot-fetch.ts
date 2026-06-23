/**
 * test-anti-bot-fetch — hermetic checks for the Jina anti-bot fetch tier (Build B):
 *   - detectBotWall fingerprint (Cloudflare/Turnstile challenge served as a 200)
 *   - needsAntiBot ladder predicate (escalate only when free tiers truly failed)
 *   - JinaFetchProvider request/response parsing (injected fetch — no network, no key)
 *   - per-run call cap
 *   - fetchPages ladder: Jina fires for an HH-likely walled venue, is SKIPPED when hhLikely=false
 * Run: tsx scripts/test-anti-bot-fetch.ts
 */
import assert from "node:assert/strict";
import { detectBotWall } from "@/lib/verification/fetchUrl";
import { needsAntiBot, fetchPages } from "@/lib/ai/siteContent";
import { JinaFetchProvider } from "@/lib/places/fetchProviders/jina";
import { __resetAntiBotCalls, antiBotCallsUsed } from "@/lib/places/fetchProviders";
import type { FetchProvider } from "@/lib/places/fetchProviders";

let passed = 0;
function check(name: string, fn: () => void) {
  fn(); passed++; console.log(`  ✓ ${name}`);
}
async function acheck(name: string, fn: () => Promise<void>) {
  await fn(); passed++; console.log(`  ✓ ${name}`);
}

const CF_PAGE =
  `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>` +
  `<div class="cf-browser-verification"></div>Enable JavaScript and cookies to continue` +
  `<script>window._cf_chl_opt={}</script></body></html>`;

// --- detectBotWall ---------------------------------------------------------------------------
check("detectBotWall matches Cloudflare challenge markup", () => {
  assert.equal(detectBotWall(CF_PAGE), true);
  assert.equal(detectBotWall("checking your browser before accessing"), true);
});
check("detectBotWall does NOT match normal restaurant prose", () => {
  assert.equal(detectBotWall("Happy Hour 3-6pm daily. $5 wells, $6 wines. Join us at the bar!"), false);
  assert.equal(detectBotWall(""), false);
});

// --- needsAntiBot ----------------------------------------------------------------------------
check("needsAntiBot: a flagged bot wall escalates", () => {
  assert.equal(needsAntiBot({ url: "u", ok: true, contentText: "x", blocked: "bot_wall" }), true);
});
check("needsAntiBot: a RENDERED challenge page (text fingerprint) escalates", () => {
  assert.equal(needsAntiBot({ url: "u", ok: true, contentText: "Just a moment... enable javascript and cookies" }), true);
});
check("needsAntiBot: good HH text does NOT escalate (free tier won)", () => {
  assert.equal(needsAntiBot({ url: "u", ok: true, contentText: "Happy Hour 3-6pm $5 wells ".repeat(40) }), false);
});
check("needsAntiBot: a PDF/image doc does NOT escalate", () => {
  assert.equal(needsAntiBot({ url: "u", ok: true, isPdf: true, pdfBase64: "AA" }), false);
  assert.equal(needsAntiBot({ url: "u", ok: true, isImage: true, imageBase64: "AA" }), false);
});
check("needsAntiBot: a page with menu media links to follow does NOT escalate", () => {
  assert.equal(needsAntiBot({ url: "u", ok: true, contentText: "short", mediaLinks: ["https://x/menu.pdf"] }), false);
});
check("needsAntiBot: a bot-wall STATUS escalates; a plain 404 does not", () => {
  assert.equal(needsAntiBot({ url: "u", ok: false, status: 403 }), true);
  assert.equal(needsAntiBot({ url: "u", ok: false, status: 404 }), false);
});

// --- JinaFetchProvider (injected fetch) ------------------------------------------------------
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function textResponse(body: string): Response {
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) } as unknown as Response;
}
function pngResponse(bytes: Uint8Array): Response {
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer } as unknown as Response;
}

// --- fetchPages ladder: gating + ordering (mock global fetch to serve a Cloudflare wall) -----
const realFetch = globalThis.fetch;
function mockWalledFetch(): typeof fetch {
  return (async (url: string) => {
    if (url.endsWith("/robots.txt")) return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    // The venue page is a Cloudflare challenge (200, no real content).
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "text/html" : null) },
      text: async () => CF_PAGE,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function fakeProvider(log: string[]): FetchProvider {
  return {
    name: "jina-test",
    async fetchText(u: string) { log.push(`text:${u}`); return { ok: true, contentText: "Happy Hour 4-6pm, $6 wines daily" }; },
    async fetchScreenshot(u: string) { log.push(`shot:${u}`); return { ok: true, imageBase64: "AAAA", imageMediaType: "image/png" as const }; },
  };
}

async function main() {
  await acheck("JinaFetchProvider.fetchText returns markdown body + sends Bearer auth", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return textResponse("# Bar X\nHappy Hour 3-6pm, $5 wells");
    }) as unknown as typeof fetch;
    const p = new JinaFetchProvider({ apiKey: "k-test", fetchImpl });
    const r = await p.fetchText("https://barx.com/hh");
    assert.equal(r.ok, true);
    assert.match(r.contentText ?? "", /Happy Hour 3-6pm/);
    assert.equal(calls[0].url, "https://r.jina.ai/https://barx.com/hh");
    assert.equal(calls[0].headers.Authorization, "Bearer k-test");
  });

  await acheck("JinaFetchProvider.fetchScreenshot: JSON screenshotUrl → downloaded PNG as base64", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const fetchImpl = (async (url: string) => {
      if (url.startsWith("https://r.jina.ai/")) return jsonResponse({ data: { screenshotUrl: "https://storage.test/shot.png" } });
      if (url === "https://storage.test/shot.png") return pngResponse(png);
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    const p = new JinaFetchProvider({ apiKey: "k", fetchImpl });
    const r = await p.fetchScreenshot("https://risewoodfire.com/hh-menu");
    assert.equal(r.ok, true);
    assert.equal(r.imageMediaType, "image/png");
    assert.equal(r.imageBase64, Buffer.from(png).toString("base64"));
  });

  await acheck("JinaFetchProvider.fetchScreenshot: missing screenshotUrl → not ok, no throw", async () => {
    const fetchImpl = (async () => jsonResponse({ data: {} })) as unknown as typeof fetch;
    const r = await new JinaFetchProvider({ apiKey: "k", fetchImpl }).fetchScreenshot("https://x.com");
    assert.equal(r.ok, false);
  });

  try {
    globalThis.fetch = mockWalledFetch();

    await acheck("ladder: HH-likely walled venue → Jina text recovers the HH content", async () => {
      __resetAntiBotCalls();
      const log: string[] = [];
      const pages = await fetchPages(["https://walledbar.com/"], 3, { antiBot: fakeProvider(log), hhLikely: true });
      assert.ok(log.some((l) => l.startsWith("text:")), "Jina text should have been called");
      assert.ok(pages.some((p) => /Happy Hour 4-6pm/.test(p.text ?? "")), "recovered HH text should surface as a page");
      assert.equal(antiBotCallsUsed() >= 1, true);
    });

    await acheck("ladder: hhLikely=false SKIPS the paid Jina tier entirely (cost gating)", async () => {
      __resetAntiBotCalls();
      const log: string[] = [];
      await fetchPages(["https://walledbar.com/"], 3, { antiBot: fakeProvider(log), hhLikely: false });
      assert.deepEqual(log, [], "Jina must not be called for a non-HH-likely venue");
      assert.equal(antiBotCallsUsed(), 0);
    });

    await acheck("ladder: walled origin + render returns content-less consent → Jina SCREENSHOT fires (Rise Woodfire)", async () => {
      __resetAntiBotCalls();
      // Plain fetch: 403 (walled origin). Render: a long Toast/cookie-consent page with NO HH and
      // no bot-wall text — needsAntiBot alone can't tell it from real content, but the walled
      // origin justifies escalating to the screenshot.
      globalThis.fetch = (async (url: string) => {
        if (url.endsWith("/robots.txt")) return { ok: false, status: 404, text: async () => "" } as unknown as Response;
        return { ok: false, status: 403, url, headers: { get: () => null }, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
      }) as unknown as typeof fetch;
      const consent = "Manage your consent preferences. Cookies and similar technologies. ".repeat(40);
      // The consent render also links JUNK media (Toast ordering button) that must NOT block
      // escalation — this was the real Rise Woodfire bug.
      const render = async (u: string) => ({ url: u, ok: true, contentText: consent, mediaLinks: ["https://order.toasttab.com/x"] });
      const log: string[] = [];
      const provider: FetchProvider = {
        name: "jina-test",
        async fetchText() { log.push("text"); return { ok: true, contentText: consent }; }, // no HH in text
        async fetchScreenshot() { log.push("shot"); return { ok: true, imageBase64: "QUJD", imageMediaType: "image/png" as const }; },
      };
      const pages = await fetchPages(["https://risewoodfire.com/"], 3, { render, antiBot: provider, hhLikely: true });
      assert.deepEqual(log, ["text", "shot"], "text yields no HH → escalate to screenshot");
      assert.ok(pages.some((p) => p.imageBase64 && p.fromAntiBot), "the Jina screenshot must surface as an extractable image page");
      globalThis.fetch = mockWalledFetch();
    });

    await acheck("ladder: no provider configured → no escalation, no throw", async () => {
      __resetAntiBotCalls();
      const pages = await fetchPages(["https://walledbar.com/"], 3, { antiBot: null, hhLikely: true });
      // The walled challenge page is all we get; the call must still resolve cleanly.
      assert.ok(Array.isArray(pages));
      assert.equal(antiBotCallsUsed(), 0);
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
