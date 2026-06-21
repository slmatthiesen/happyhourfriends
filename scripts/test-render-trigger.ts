/**
 * Unit checks for needsBrowserRender — decides when the plain fetch escalates to the headless
 * browser. No DB/AI/network ($0). Run: pnpm tsx scripts/test-render-trigger.ts
 */
import assert from "node:assert/strict";
import { needsBrowserRender } from "@/lib/ai/siteContent";
import type { FetchResult } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const ok = (over: Partial<FetchResult>): FetchResult => ({ url: "https://x.com/", ok: true, ...over });

check("robots-blocked → render (Cheesecake Factory's menu host disallows /)", () =>
  assert.equal(needsBrowserRender({ url: "u", ok: false, blockedByRobots: true }), true));
check("bot wall 403 → render", () =>
  assert.equal(needsBrowserRender({ url: "u", ok: false, status: 403 }), true));
check("genuine 404 → no render (dead URL, don't launch a browser per miss)", () =>
  assert.equal(needsBrowserRender({ url: "u", ok: false, status: 404 }), false));
check("500 → no render", () =>
  assert.equal(needsBrowserRender({ url: "u", ok: false, status: 500 }), false));

check("a PDF result → no render (it's already the doc)", () =>
  assert.equal(needsBrowserRender(ok({ isPdf: true, pdfBase64: "JVBERi0=" })), false));
check("an image result → no render", () =>
  assert.equal(needsBrowserRender(ok({ isImage: true, imageBase64: "abc" })), false));

check("empty shell, no media → render (JS app frame, nothing extracted)", () =>
  assert.equal(needsBrowserRender(ok({ contentText: "" })), true));
check("empty shell BUT links a menu doc → no render (follow the doc instead)", () =>
  assert.equal(needsBrowserRender(ok({ contentText: "", mediaLinks: ["https://x.com/menu.pdf"] })), false));

check("junk machine-text → render (SSR token soup needs JS)", () => {
  const junk = '{"a":1,"b":2,"c":3}'.repeat(40); // >200 chars, ~no spaces, codey-heavy
  assert.equal(needsBrowserRender(ok({ contentText: junk })), true);
});

// The new clause: a NON-robots-blocked SPA menu shell that strips to short, signal-less
// boilerplate (what CCF's page looks like to a robots-ignoring fetch).
check("short boilerplate shell, no signal, no media → render", () => {
  const shell = "The Cheesecake Factory\nWeb Accessibility\nPrivacy Policy\nTerms of Use\n© 2026 The Cheesecake Factory.";
  assert.equal(needsBrowserRender(ok({ contentText: shell })), true);
});
check("short page that DOES mention happy hour → no render (we already have the signal)", () =>
  assert.equal(needsBrowserRender(ok({ contentText: "Happy Hour Mon-Fri 3-6pm in the bar." })), false));
check("short page that shows a price → no render (deals already present)", () =>
  assert.equal(needsBrowserRender(ok({ contentText: "Drafts $5 all night." })), false));
check("short shell that links a menu doc → no render (follow the doc)", () =>
  assert.equal(needsBrowserRender(ok({ contentText: "Welcome.", mediaLinks: ["https://x.com/menu.pdf"] })), false));
check("a full content page (long, no signal) → no render", () =>
  assert.equal(needsBrowserRender(ok({ contentText: "About our restaurant. ".repeat(60) })), false));

console.log(`\n✓ ${passed} render-trigger checks passed.`);
