/**
 * Runnable unit checks for siteTriage pure helpers (no test framework in repo).
 * Run: npx tsx scripts/test-site-triage.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  classifyUrl,
  isParkedHtml,
  extractHhSignalLinks,
  resolveEnrichAction,
  type SiteVerdict,
} from "@/lib/places/siteTriage";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// classifyUrl
check("empty → none", () => assert.equal(classifyUrl(null).kind, "none"));
check("facebook → social_only", () =>
  assert.equal(classifyUrl("https://www.facebook.com/obriens").kind, "social_only"));
check("linktree → social_only", () =>
  assert.equal(classifyUrl("https://linktr.ee/unostacosaz").kind, "social_only"));
check("doordash → social_only", () =>
  assert.equal(classifyUrl("https://www.doordash.com/store/x").kind, "social_only"));
check("real domain → real", () => {
  const c = classifyUrl("http://brixphoenix.com/");
  assert.equal(c.kind, "real");
  assert.equal(c.url, "http://brixphoenix.com/");
});

// isParkedHtml
check("for-sale page is parked", () =>
  assert.equal(isParkedHtml('<title>brix.com is for sale</title><body>Buy this domain</body>'), true));
check("real menu page is not parked", () =>
  assert.equal(isParkedHtml("<body><nav><a href='/happy-hour'>Happy Hour</a></nav> lots of real content here ".repeat(20) + "</body>"), false));

// extractHhSignalLinks
check("finds /happy-hour link, resolved absolute", () => {
  const links = extractHhSignalLinks('<a href="/happy-hour">HH</a><a href="/about">About</a>', "https://brix.com/");
  assert.deepEqual(links, ["https://brix.com/happy-hour"]);
});
check("finds drink menu + dedupes", () => {
  const links = extractHhSignalLinks(
    '<a href="/drink-menu">Drinks</a><a href="/drink-menu">Drinks</a><a href="/menus">Menus</a>',
    "https://x.com/",
  );
  assert.deepEqual(links.sort(), ["https://x.com/drink-menu", "https://x.com/menus"]);
});
check("anchor text 'Happy Hour' counts even with opaque href", () => {
  const links = extractHhSignalLinks('<a href="/p/123">Happy Hour Specials</a>', "https://x.com/");
  assert.deepEqual(links, ["https://x.com/p/123"]);
});

// resolveEnrichAction — the decision matrix
const real = (r: "ok" | "dead" | "parked", hh: string[] = []): SiteVerdict => ({
  kind: "real", url: "http://x.com", reachability: r, hhSignalUrls: hh,
  decision: r === "ok" ? "extract" : "kill", reason: r,
});
check("real+ok → extract", () =>
  assert.equal(resolveEnrichAction(real("ok"), 0.6).action, "extract"));
check("real+dead → kill", () =>
  assert.equal(resolveEnrichAction(real("dead"), 0.9).action, "kill"));
check("real+parked → kill", () =>
  assert.equal(resolveEnrichAction(real("parked"), 0.9).action, "kill"));
check("social_only → stub", () =>
  assert.equal(resolveEnrichAction(
    { kind: "social_only", url: "http://fb", reachability: null, hhSignalUrls: [], decision: "stub", reason: "social" }, 0.9
  ).action, "stub"));
check("no-site, likelihood>0.5 → extract (go for it)", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, 0.62
  ).action, "extract"));
check("no-site, likelihood<=0.5 → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, 0.33
  ).action, "kill"));
check("no-site, likelihood null → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, null
  ).action, "kill"));

console.log(`\n${passed} checks passed.`);
