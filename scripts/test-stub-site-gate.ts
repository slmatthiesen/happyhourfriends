/**
 * Unit checks for the first-party stub site gate (no test framework in repo).
 * Run: npx tsx scripts/test-stub-site-gate.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { classifyStubSite, PARKED_SITE_RE } from "@/lib/places/stubSiteGate";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const sig = (o: Partial<Parameters<typeof classifyStubSite>[0]> = {}) => ({
  name: "X", primaryType: "restaurant", types: ["restaurant"], siteReachable: true, siteText: "", ...o,
});
const LIVE = (text: string) => sig({ siteText: text });
const DEAD = (name: string) => sig({ name, siteReachable: false, siteText: "" });
const FILLER = " lorem ipsum dolor sit amet ".repeat(20); // pushes past MIN_CONTENT_CHARS

check("HIDE: bowling alleys, always (by type or name) — but not poke/bowl restaurants", () => {
  assert.equal(classifyStubSite(sig({ primaryType: "bowling_alley" })).action, "hide");
  assert.equal(classifyStubSite(sig({ name: "Tower Lanes Entertainment Center" })).action, "hide");
  assert.equal(classifyStubSite(LIVE("acai bowls and poke" + FILLER)).action, "keep", "'bowls' is not bowling");
  assert.equal(classifyStubSite(sig({ name: "The Curl Bowls & Rolls", siteText: "poke" + FILLER })).action, "keep");
});

check("KEEP: live site stays a crowdsource stub even with no alcohol/HH text (the Achilles case)", () => {
  assert.equal(classifyStubSite(LIVE("Order online for lunch. Gyros, falafel, salads." + FILLER)).action, "keep");
});

check("KEEP: alcohol-positive type/name, even when site dead/parked", () => {
  assert.equal(classifyStubSite(DEAD("Foo Brewing Co.")).action, "keep");
  assert.equal(classifyStubSite(sig({ primaryType: "wine_bar", siteReachable: false })).action, "keep");
  assert.equal(classifyStubSite({ name: "Sam & Doms Bar & Grill", primaryType: "restaurant", types: [], siteReachable: true, siteText: "Website is ready. The content is to be added." }).action, "keep");
});

check("KEEP: widened name signals rescue dead-site alcohol venues", () => {
  for (const name of ["Kindred Public House", "Valo Wine Tasting Room", "Sake Sushi", "The Apéro Club", "Uno Más Tacos & Tequila", "Kizuki Ramen & Izakaya"]) {
    assert.equal(classifyStubSite(DEAD(name)).action, "keep", `${name} should be kept by name signal`);
  }
});

check("KEEP: alive-but-unreadable (bot-wall/robots) is uncertain, not hidden", () => {
  assert.equal(classifyStubSite(sig({ siteReachable: false, siteUnreadable: true })).action, "keep");
});

check("HIDE: dead / parked / empty site", () => {
  assert.equal(classifyStubSite(sig({ siteReachable: false })).action, "hide");
  assert.equal(classifyStubSite(LIVE("Website is ready. The content is to be added.")).action, "hide");
  assert.equal(classifyStubSite(LIVE("short")).action, "hide", "below MIN_CONTENT_CHARS");
});

check("PARKED_SITE_RE catches common placeholders", () => {
  assert.equal(PARKED_SITE_RE.test("This domain is for sale"), true);
  assert.equal(PARKED_SITE_RE.test("Future home of something great"), true);
  assert.equal(PARKED_SITE_RE.test("Our dinner menu and reservations"), false);
});

console.log(`\n${passed} checks passed.`);
