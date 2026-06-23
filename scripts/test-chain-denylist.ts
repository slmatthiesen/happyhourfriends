/**
 * Unit checks for isDenylistedChain — which national chains are filtered at discovery.
 * No network ($0). Run: pnpm tsx scripts/test-chain-denylist.ts
 *
 * Locks the 2026-06-23 editorial reversal: Applebee's, Yard House, and Red Robin are now
 * KEPT (common American sit-down spots with real happy hours). This test exists to catch a
 * silent re-add — and to confirm the rest of the casual-dining tier is still denied.
 */
import assert from "node:assert/strict";
import { isDenylistedChain } from "@/lib/places/chainDenylist";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("Applebee's is KEPT (un-denylisted 2026-06-23)", () => {
  assert.equal(isDenylistedChain("Applebee's Grill + Bar"), false);
});
check("Yard House is KEPT", () => {
  assert.equal(isDenylistedChain("Yard House"), false);
});
check("Red Robin is KEPT", () => {
  assert.equal(isDenylistedChain("Red Robin Gourmet Burgers and Brews"), false);
});

check("Red Lobster + Olive Garden still denied (in CHAINS, not the HH_CHAINS override)", () => {
  assert.equal(isDenylistedChain("Red Lobster"), true);
  assert.equal(isDenylistedChain("Olive Garden Italian Restaurant"), true);
});
check("Chili's / Outback were ALREADY kept via HH_CHAINS (override), not denied", () => {
  // Documents the real mechanism: HH_CHAINS allowlists these despite CHAINS listing them.
  assert.equal(isDenylistedChain("Chili's Grill & Bar"), false);
  assert.equal(isDenylistedChain("Outback Steakhouse"), false);
});
check("fast food still denied", () => {
  assert.equal(isDenylistedChain("McDonald's"), true);
  assert.equal(isDenylistedChain("Taco Bell"), true);
});
check("independent venue not denied", () => {
  assert.equal(isDenylistedChain("Trials Pub"), false);
});

console.log(`\n✓ ${passed} chain-denylist checks passed.`);
