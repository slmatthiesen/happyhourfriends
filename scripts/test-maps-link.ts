/**
 * Unit checks for the maps deep-link helper. Run: npx tsx scripts/test-maps-link.ts
 * — exits non-zero on any failure. `isApplePlatform` reads navigator and is NOT
 * tested here (it's a thin UA wrapper exercised only in the browser).
 */
import assert from "node:assert/strict";
import { directionsUrl } from "@/lib/geo/mapsLink";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const origin = { lat: 3, lng: 4 };
const dest = { lat: 1, lng: 2 };

check("Apple directions with origin → saddr/daddr", () =>
  assert.equal(
    directionsUrl(dest, origin, true),
    "https://maps.apple.com/?saddr=3,4&daddr=1,2",
  ));
check("Google directions with origin → origin/destination", () =>
  assert.equal(
    directionsUrl(dest, origin, false),
    "https://www.google.com/maps/dir/?api=1&origin=3,4&destination=1,2",
  ));
check("Apple no origin → query", () =>
  assert.equal(directionsUrl(dest, null, true), "https://maps.apple.com/?q=1,2"));
check("Google no origin → search query", () =>
  assert.equal(
    directionsUrl(dest, null, false),
    "https://www.google.com/maps/search/?api=1&query=1,2",
  ));
check("address destination is URL-encoded", () =>
  assert.equal(
    directionsUrl({ address: "1 Main St, Tacoma" }, null, false),
    "https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Tacoma",
  ));

console.log(`\n${passed} checks passed.`);
