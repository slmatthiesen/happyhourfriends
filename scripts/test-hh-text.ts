/**
 * Runnable check: the canonical HH matcher catches every common spelling/case
 * (the recall bug: harvest used to match the spaced form only), and scoreHhUrl
 * ranks candidate pages most→least likely.
 *
 * Run: tsx scripts/test-hh-text.ts
 */
import assert from "node:assert";
import { matchesHappyHour, scoreHhUrl, HH_RE } from "@/lib/places/hhText";

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

check("HH_RE synonyms from the 2026-06-11 review corpus", () => {
  assert.ok(HH_RE.test("HAPPIER HOURS | 3-6 PM MONDAY THRU FRIDAY")); // The Monica
  assert.ok(HH_RE.test("Join us for Social Hour every weekday"));     // PYRO
  assert.ok(HH_RE.test("Power Hour 1-2pm: $2 off everything"));       // Orangedale
  assert.ok(scoreHhUrl("https://www.pyrophx.com/social-hour") >= 100);
  assert.ok(!HH_RE.test("open 24 hours"), "plain 'hours' must not match");
  assert.ok(!HH_RE.test("rush hour traffic"), "'rush hour' must not match");
});

console.log(`\n${passed} checks passed.`);
