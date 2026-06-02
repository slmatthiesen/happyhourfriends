/**
 * Runnable unit checks for first-party URL matching (no test framework in repo).
 * Run: npx tsx scripts/test-first-party.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { isFirstPartyUrl } from "@/lib/contribution/firstParty";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("exact host matches", () =>
  assert.equal(isFirstPartyUrl("https://eatdoughbird.com/menu", "https://eatdoughbird.com"), true));
check("www vs bare matches", () =>
  assert.equal(isFirstPartyUrl("https://www.eatdoughbird.com/x", "https://eatdoughbird.com"), true));
check("subdomain of site matches", () =>
  assert.equal(isFirstPartyUrl("https://menu.eatdoughbird.com/hh", "https://eatdoughbird.com"), true));
check("case-insensitive", () =>
  assert.equal(isFirstPartyUrl("https://EatDoughbird.com", "https://eatdoughbird.com"), true));
check("different domain is not first-party", () =>
  assert.equal(isFirstPartyUrl("https://yelp.com/biz/doughbird", "https://eatdoughbird.com"), false));
check("denylisted aggregator never first-party", () =>
  assert.equal(isFirstPartyUrl("https://ultimatehappyhours.com/x", "https://ultimatehappyhours.com"), false));
check("no stored website -> not first-party", () =>
  assert.equal(isFirstPartyUrl("https://eatdoughbird.com", null), false));
check("no submitted url -> not first-party", () =>
  assert.equal(isFirstPartyUrl(null, "https://eatdoughbird.com"), false));
check("unparseable url -> not first-party", () =>
  assert.equal(isFirstPartyUrl("not a url", "https://eatdoughbird.com"), false));

console.log(`\n${passed} checks passed.`);
