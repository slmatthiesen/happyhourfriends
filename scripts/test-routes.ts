/**
 * Unit checks for the URL path builders. Run: npx tsx scripts/test-routes.ts
 * Exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  normalizeStateSlug,
  cityPath,
  neighborhoodPath,
  venuePath,
  legacyCityRedirects,
} from "@/lib/routes";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("normalizeStateSlug lowercases", () =>
  assert.equal(normalizeStateSlug("WA"), "wa"));
check("normalizeStateSlug trims + lowercases", () =>
  assert.equal(normalizeStateSlug(" Az "), "az"));

check("cityPath nests state/city, state lowercased", () =>
  assert.equal(cityPath("WA", "tacoma"), "/wa/tacoma"));
check("neighborhoodPath nests under city", () =>
  assert.equal(neighborhoodPath("AZ", "tucson", "sam-hughes"), "/az/tucson/sam-hughes"));
check("venuePath nests venue under city", () =>
  assert.equal(venuePath("CA", "daly-city", "joes-bar"), "/ca/daly-city/venue/joes-bar"));

check("legacyCityRedirects emits exact + wildcard 301 per city", () => {
  const r = legacyCityRedirects([
    { bareSlug: "tacoma", stateSlug: "wa" },
  ]);
  // exact bare slug → nested, and child wildcard → nested child, both permanent.
  assert.deepEqual(r, [
    { source: "/tacoma", destination: "/wa/tacoma", permanent: true },
    { source: "/tacoma/:path*", destination: "/wa/tacoma/:path*", permanent: true },
  ]);
});

console.log(`\n${passed} checks passed`);
