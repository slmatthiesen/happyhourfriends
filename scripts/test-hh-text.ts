/**
 * Runnable check: the canonical HH matcher catches every common spelling/case
 * (the recall bug: harvest used to match the spaced form only), and scoreHhUrl
 * ranks candidate pages most→least likely.
 *
 * Run: tsx scripts/test-hh-text.ts
 */
import assert from "node:assert";
import { matchesHappyHour, scoreHhUrl, HH_RE, hasPriceOrDealSignal, looksLikeMenuDoc } from "@/lib/places/hhText";
import { extractMediaLinksDetailed } from "@/lib/places/siteTriage";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("matches every spelling + case", () => {
  for (const s of ["Happy Hour 4-6pm", "happy-hour menu", "HappyHour specials", "happy_hour", "HAPPY HOUR"]) {
    assert.ok(matchesHappyHour(s), `should match: ${s}`);
  }
});

check("does not false-positive on unrelated text", () => {
  for (const s of ["lunch menu", "happily ever after", "an hour later", "happy birthday"]) {
    assert.ok(!matchesHappyHour(s), `should NOT match: ${s}`);
  }
});

check("scoreHhUrl ranks HH page above specials above generic menu above none", () => {
  const hh = scoreHhUrl("https://x.com/happy-hour");
  const hhMenu = scoreHhUrl("https://x.com/happyhour-menu");
  const specials = scoreHhUrl("https://x.com/specials");
  const drinks = scoreHhUrl("https://x.com/drink-menu");
  const menu = scoreHhUrl("https://x.com/menu");
  const none = scoreHhUrl("https://x.com/about");
  assert.ok(hhMenu >= hh, "hh+menu >= hh");
  assert.ok(hh > specials && specials > drinks && drinks > menu && menu > none, "ordering");
  assert.equal(none, 0, "unrelated url scores 0");
});

check("scoreHhUrl catches no-space + underscore spellings in the path", () => {
  assert.ok(scoreHhUrl("https://x.com/happyhour") >= 100);
  assert.ok(scoreHhUrl("https://x.com/happy_hour") >= 100);
});

check("HH_RE multilingual terms (Iberia vermut-hour bug, 2026-06-16)", () => {
  assert.ok(HH_RE.test("Vermut Hour - for two $24.65"));           // Iberia (Spanish vermouth hour)
  assert.ok(HH_RE.test("Disfruta la hora del vermut"));            // "hora del vermut"
  assert.ok(HH_RE.test("Hora Feliz 5-7pm"));                       // "hora feliz" = happy hour
  assert.ok(HH_RE.test("Aperitivo every evening 5-7"));            // Italian aperitivo ritual
  assert.ok(HH_RE.test("Apericena buffet with your drink"));       // Italian apericena
  assert.ok(scoreHhUrl("https://www.iberiarestaurant.com/vermut-hour/") >= 100);
  assert.ok(scoreHhUrl("https://x.com/aperitivo") >= 100);
});
check("multilingual terms don't false-positive on plain ingredients", () => {
  assert.ok(!matchesHappyHour("Negroni with sweet vermouth"));     // vermouth (ingredient) ≠ vermut hour
  assert.ok(!matchesHappyHour("dinner is served at this hora"));   // bare "hora" w/o feliz/vermut
});
check("HH_RE synonyms from the 2026-06-11 review corpus", () => {
  assert.ok(HH_RE.test("HAPPIER HOURS | 3-6 PM MONDAY THRU FRIDAY")); // The Monica
  assert.ok(HH_RE.test("Join us for Social Hour every weekday"));     // PYRO
  assert.ok(HH_RE.test("Power Hour 1-2pm: $2 off everything"));       // Orangedale
  assert.ok(scoreHhUrl("https://www.pyrophx.com/social-hour") >= 100);
  assert.ok(!HH_RE.test("open 24 hours"), "plain 'hours' must not match");
  assert.ok(!HH_RE.test("rush hour traffic"), "'rush hour' must not match");
});

check("HH_RE rebranded-hour synonyms (Pausa 'Spritz Hour' PDF, San Mateo 2026-06-29)", () => {
  // Pausa publishes its HH as "Spritz Hour" in a PDF; the page's "Spritz Hour Menu" anchor
  // must mark that PDF as hhContext (siteTriage uses HH_RE) so it wins the byte budget.
  assert.ok(HH_RE.test("Spritz Hour in the parklet, 3-6pm daily")); // Pausa Bar & Cookery
  assert.ok(HH_RE.test("Join us for Sunset Hour"));
  assert.ok(HH_RE.test("Sundowners on the patio, $8 spritzes"));
  // Filename/URL ranking: a spritz-hour doc scores like a happy-hour doc and reads as a menu.
  assert.ok(scoreHhUrl("https://www.pausasanmateo.com/s/spritz-hour.pdf") >= 100);
  assert.ok(looksLikeMenuDoc("https://x.com/Spritz-Hour.pdf"));
  // Boundary: "golden hour" is deliberately EXCLUDED — it's overwhelmingly a photography/patio
  // term, not an HH rebrand, so it would systematically false-escalate non-HH pages.
  assert.ok(!HH_RE.test("enjoy the golden hour on our rooftop"), "poetic 'golden hour' excluded");
  assert.ok(!HH_RE.test("open 24 hours a day"), "bare 'hours' still must not match");
});

check("Spritz Hour anchor ranks its PDF first (the Pausa doc-budget bug, end-to-end)", () => {
  // Two menu PDFs; only the one the page labels "Spritz Hour" holds the HH deal. Before HH_RE
  // learned "spritz hour" its anchor scored 0, so the Dinner PDF won the byte budget and we
  // extracted nothing. This locks the anchor-context ranking, not just the regex.
  const html = `<p>Our menus</p>
    <a href="/s/Pausa-Dinner.pdf">Dinner Menu</a>
    <a href="/s/Bar-Menu-Hour.pdf">Spritz Hour Menu</a>`;
  const links = extractMediaLinksDetailed(html, "http://www.pausasanmateo.com/");
  const spritz = links.find((l) => l.url.includes("Bar-Menu-Hour"));
  const dinner = links.find((l) => l.url.includes("Dinner"));
  assert.ok(spritz?.hhContext, "Spritz Hour anchor → hhContext=true");
  assert.ok(!dinner?.hhContext, "Dinner anchor → hhContext=false");
  assert.equal(links[0].url, spritz?.url, "HH-context PDF ranks first, wins the byte budget");
});

check("hasPriceOrDealSignal fires on real prices/deals (enrich escalation trigger)", () => {
  for (const s of [
    "$9 cocktails | $7 wine | $5 beer",   // Santo Mezcal (the bug)
    "$ 12 select appetizers",             // space after $
    "1/2 off drinks 4-6pm",
    "half-price wings",
    "50% off all drafts",
    "$5 off pitchers",
    "drink specials every night",
    "Industry Night every Sunday",
  ]) {
    assert.ok(hasPriceOrDealSignal(s), `should escalate: ${s}`);
  }
});

check("hasPriceOrDealSignal stays $0 on bare schedules / non-deal text", () => {
  for (const s of [
    "Happy Hour Mon–Fri 3–6pm",          // bare time, no prices → keep for $0
    "Happy Hour daily",                   // bare "daily" must not trip it
    "Social Hour 4-6pm",
    "Open 24 hours, kitchen until 11pm",
    "Our story began in 1998 on the waterfront",
    "Reservations recommended for parties of six",
  ]) {
    assert.ok(!hasPriceOrDealSignal(s), `should NOT escalate: ${s}`);
  }
});

check("hasPriceOrDealSignal ignores price-like tokens inside URLs", () => {
  // signalText strips URLs first, so a query string can't fake a deal.
  assert.ok(!hasPriceOrDealSignal("see https://x.com/menu?id=$5off for hours"));
});

console.log(`\n${passed} checks passed.`);
