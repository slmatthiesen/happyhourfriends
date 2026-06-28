/**
 * Unit checks for the first-party stub site gate (no test framework in repo).
 * Run: npx tsx scripts/test-stub-site-gate.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { classifyStubSite, SITE_ALCOHOL_RE, PARKED_SITE_RE } from "@/lib/places/stubSiteGate";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const LIVE = (text: string) => ({ name: "X", primaryType: "restaurant", types: ["restaurant"], siteReachable: true, siteText: text });
const FILLER = " lorem ipsum dolor sit amet ".repeat(20); // pushes past MIN_CONTENT_CHARS

check("KEEP: alcohol-positive protected when site is unreachable (no drop on a transient blip)", () => {
  assert.equal(classifyStubSite({ name: "Foo Brewing Co.", primaryType: "restaurant", types: ["restaurant"], siteReachable: false, siteText: "" }).action, "keep");
  assert.equal(classifyStubSite({ name: "X", primaryType: "wine_bar", types: ["wine_bar"], siteReachable: false, siteText: "" }).action, "keep");
  assert.equal(classifyStubSite({ name: "Old Irish Pub", primaryType: "restaurant", types: [], siteReachable: false, siteText: "" }).action, "keep");
});

check("KEEP: alcohol-named kept even when site is parked/dead (operator steer)", () => {
  // A known bar/wine venue stays a crowdsource stub even if its website is dormant.
  assert.equal(classifyStubSite({ name: "Sam & Doms Bar & Grill", primaryType: "restaurant", types: [], siteReachable: true, siteText: "Website is ready. The content is to be added." }).action, "keep");
  assert.equal(classifyStubSite({ name: "Valo Wine Tasting Room", primaryType: "restaurant", types: [], siteReachable: false, siteText: "" }).action, "keep");
});

check("KEEP: widened name signals (public house, tasting room, sake, apéro, bar & grill)", () => {
  const noEvidence = (name: string) => classifyStubSite({ name, primaryType: "restaurant", types: [], siteReachable: true, siteText: "lunch menu" + " filler".repeat(60) });
  for (const name of ["Kindred Public House", "Valo Wine Tasting Room", "Sake Sushi", "The Apéro Club", "Sam & Doms Bar & Grill"]) {
    assert.equal(noEvidence(name).action, "keep", `${name} should be kept by name signal`);
  }
});

check("KEEP: alive-but-unreadable (bot-wall/robots) is uncertain, not hidden", () => {
  assert.equal(classifyStubSite({ name: "X", primaryType: "restaurant", types: [], siteReachable: false, siteText: "", siteUnreadable: true }).action, "keep");
  // but if we DID read content despite a blocked sub-page, classify on the content (no free pass)
  assert.equal(classifyStubSite({ name: "X", primaryType: "restaurant", types: [], siteReachable: true, siteText: "lunch only" + " filler".repeat(60), siteUnreadable: true }).action, "hide");
});

check("HIDE: dead / parked / empty site (option 3)", () => {
  assert.equal(classifyStubSite({ name: "X", primaryType: "restaurant", types: [], siteReachable: false, siteText: "" }).action, "hide");
  assert.equal(classifyStubSite(LIVE("Website is ready. The content is to be added.")).action, "hide");
  assert.equal(classifyStubSite(LIVE("short")).action, "hide", "below MIN_CONTENT_CHARS");
});

check("HIDE: live site, no alcohol or HH evidence — the Achilles case (option 1)", () => {
  const v = classifyStubSite(LIVE("Order online for lunch. Gyros, falafel, salads, fresh pita." + FILLER));
  assert.equal(v.action, "hide");
  assert.match(v.reason, /no alcohol or HH/);
});

check("KEEP: live site that shows alcohol / HH evidence", () => {
  assert.equal(classifyStubSite(LIVE("Join us for happy hour 4-6pm." + FILLER)).action, "keep");
  assert.equal(classifyStubSite(LIVE("Full cocktail list, craft beer on tap, and wine by the glass." + FILLER)).action, "keep");
});

check("SITE_ALCOHOL_RE is precise — no false hit on 'menu' / 'special' / bare 'bar'", () => {
  assert.equal(SITE_ALCOHOL_RE.test("view our menu and daily specials at the sushi bar"), false);
  assert.equal(SITE_ALCOHOL_RE.test("a barber shop with a candy bar counter"), false);
  assert.equal(SITE_ALCOHOL_RE.test("draft beer and a negroni"), true);
  assert.equal(SITE_ALCOHOL_RE.test("WINE BY THE GLASS"), true);
});

check("PARKED_SITE_RE catches common placeholders", () => {
  assert.equal(PARKED_SITE_RE.test("This domain is for sale"), true);
  assert.equal(PARKED_SITE_RE.test("Future home of something great"), true);
  assert.equal(PARKED_SITE_RE.test("Our dinner menu and reservations"), false);
});

console.log(`\n${passed} checks passed.`);
