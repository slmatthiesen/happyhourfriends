/**
 * Hermetic unit checks for own-site HH URL priority (Component B of the auto-promote
 * design). The venue's OWN /happy-hour page must be fetched FIRST so the live window's
 * source_url is first-party and never trips the provenance gate (the "Eddie V's stored a
 * Yelp source instead of eddiev.com/happy-hour" fix). Run: npx tsx scripts/test-own-site-hh-priority.ts
 */
import assert from "node:assert/strict";
import { prioritizeOwnSiteHh } from "@/lib/places/ownSiteHhPriority";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("prepends the own-site HH url to the front", () =>
  assert.deepEqual(
    prioritizeOwnSiteHh(["https://yelp.com/biz/foo", "https://foo.com/menu"], "https://foo.com/happy-hour"),
    ["https://foo.com/happy-hour", "https://yelp.com/biz/foo", "https://foo.com/menu"],
  ));

check("dedupes if the HH url is already present (moves it to front)", () =>
  assert.deepEqual(
    prioritizeOwnSiteHh(["https://foo.com/menu", "https://foo.com/happy-hour"], "https://foo.com/happy-hour"),
    ["https://foo.com/happy-hour", "https://foo.com/menu"],
  ));

check("null HH url → unchanged list", () =>
  assert.deepEqual(prioritizeOwnSiteHh(["https://foo.com/menu"], null), ["https://foo.com/menu"]));

check("empty list + HH url → just the HH url", () =>
  assert.deepEqual(prioritizeOwnSiteHh([], "https://foo.com/happy-hour"), ["https://foo.com/happy-hour"]));

console.log(`\n${passed} checks passed.`);
