/**
 * test-stub-cleanup — hermetic checks for the keep/hide/delete classifier
 * (lib/places/stubCleanup) that drives `pnpm cleanup:stubs`.
 * Run: tsx scripts/test-stub-cleanup.ts
 */
import assert from "node:assert/strict";
import {
  classifyStub,
  DEAD_SITE_HEALTH,
  type StubSignal,
  type StubCleanupPolicy,
} from "@/lib/places/stubCleanup";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const sig = (s: Partial<StubSignal>): StubSignal => ({
  name: null, primaryType: null, types: null, websiteUrl: null, siteHealth: null, ...s,
});
const OR_SITE: StubCleanupPolicy = "alcohol-or-site";
const ALC_ONLY: StubCleanupPolicy = "alcohol-only";

check("DEAD_SITE_HEALTH is the six dead classes; blocked/ok are NOT dead", () => {
  assert.deepEqual([...DEAD_SITE_HEALTH].sort(),
    ["dns_dead", "expired_cert", "http_error", "invalid_cert", "parked", "unreachable"]);
  assert.ok(!DEAD_SITE_HEALTH.has("blocked"));
  assert.ok(!DEAD_SITE_HEALTH.has("ok"));
});

check("DELETE: menu-platform-only site (even a bar)", () => {
  const v = classifyStub(sig({ name: "Joe's Bar", primaryType: "bar", websiteUrl: "https://kwickmenu.com/x" }), OR_SITE);
  assert.equal(v.action, "delete");
});

check("DELETE: no-alcohol restaurant with no site", () => {
  assert.equal(classifyStub(sig({ name: "Pho House", primaryType: "restaurant" }), OR_SITE).action, "delete");
});

check("DELETE: no-alcohol restaurant with a dead site", () => {
  const v = classifyStub(sig({ name: "Taco Place", primaryType: "restaurant", websiteUrl: "http://x.com", siteHealth: "dns_dead" }), OR_SITE);
  assert.equal(v.action, "delete");
});

check("KEEP: alcohol-positive bar with no site (the url-less crowdsource bet) — both policies", () => {
  const bar = sig({ name: "The Tap Room", primaryType: "bar" });
  assert.equal(classifyStub(bar, OR_SITE).action, "keep");
  assert.equal(classifyStub(bar, ALC_ONLY).action, "keep");
});

check("KEEP: alcohol-by-name override even on a `restaurant` type", () => {
  assert.equal(classifyStub(sig({ name: "Behan's An Irish Pub", primaryType: "restaurant" }), ALC_ONLY).action, "keep");
});

check("KEEP: alcohol via types[] override (bar in types, restaurant primary) flows through", () => {
  assert.equal(classifyStub(sig({ name: "The Vig", primaryType: "restaurant", types: ["bar", "cocktail_bar"] }), ALC_ONLY).action, "keep");
});

check("HIDE: zero-HH cuisine (korean/viet/chinese), no alcohol — both policies", () => {
  const k = sig({ name: "KBBQ House", primaryType: "korean_restaurant", websiteUrl: "https://k.com", siteHealth: "ok" });
  assert.equal(classifyStub(k, OR_SITE).action, "hide");
  assert.equal(classifyStub(k, ALC_ONLY).action, "hide");
});

check("POLICY split: good-site restaurant — KEEP under alcohol-or-site, HIDE under alcohol-only", () => {
  const r = sig({ name: "Somerset Grill", primaryType: "american_restaurant", websiteUrl: "https://s.com", siteHealth: "ok" });
  assert.equal(classifyStub(r, OR_SITE).action, "keep");
  assert.equal(classifyStub(r, ALC_ONLY).action, "hide");
});

check("blocked (bot-wall) site is alive → not deleted; routes by policy", () => {
  const r = sig({ name: "Rise Woodfire", primaryType: "restaurant", websiteUrl: "https://r.com", siteHealth: "blocked" });
  assert.equal(classifyStub(r, OR_SITE).action, "keep");
  assert.equal(classifyStub(r, ALC_ONLY).action, "hide");
});

check("null site_health (never probed) is treated as alive → not deleted", () => {
  const r = sig({ name: "New Spot", primaryType: "restaurant", websiteUrl: "https://n.com", siteHealth: null });
  assert.equal(classifyStub(r, OR_SITE).action, "keep");
});

check("delete bucket is policy-independent (same delete under both policies)", () => {
  const junk = sig({ name: "Nowhere Cafe", primaryType: "restaurant" });
  assert.equal(classifyStub(junk, OR_SITE).action, "delete");
  assert.equal(classifyStub(junk, ALC_ONLY).action, "delete");
});

console.log(`\n${passed} checks passed.`);
