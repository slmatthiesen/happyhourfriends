/**
 * Unit checks for venueRevalidationItems path building. Run: npx tsx scripts/test-revalidate.ts
 */
import assert from "node:assert/strict";
import { venueRevalidationItems } from "@/lib/cache/revalidate";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("city-only path is nested", () => {
  const { paths, tags } = venueRevalidationItems({ stateSlug: "wa", citySlug: "tacoma" });
  assert.deepEqual(paths, ["/wa/tacoma"]);
  assert.deepEqual(tags, []);
});
check("venue + neighborhood paths nested; countsChanged tags cities-summary", () => {
  const { paths, tags } = venueRevalidationItems({
    stateSlug: "AZ", citySlug: "tucson", venueSlug: "joes", neighborhoodSlug: "sam-hughes",
    countsChanged: true,
  });
  assert.deepEqual(paths, ["/az/tucson", "/az/tucson/venue/joes", "/az/tucson/sam-hughes"]);
  assert.deepEqual(tags, ["cities-summary"]);
});

console.log(`\n${passed} checks passed`);
