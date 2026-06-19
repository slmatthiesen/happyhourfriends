/**
 * test-add-offerings — hermetic checks for buildAddOfferingRows (the pure validation/shaping
 * behind the /admin/bare-windows "add deals" form). Run: tsx scripts/test-add-offerings.ts
 */
import assert from "node:assert/strict";
import { buildAddOfferingRows } from "@/lib/recover/addOfferings";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const base = { happyHourId: "hh1", sourceUrl: "https://x.com/hh.png" };

check("shapes named offerings, trims, defaults active", () => {
  const rows = buildAddOfferingRows({ ...base, offerings: [
    { kind: "drink", category: "beer", name: "  Draft Beer ", priceCents: 500 },
    { kind: "food", category: "appetizer", name: "Gyoza", priceCents: 595 },
  ]});
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Draft Beer");
  assert.equal(rows[0].priceCents, 500);
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].sourceUrl, "https://x.com/hh.png");
});

check("drops blank-name rows", () => {
  const rows = buildAddOfferingRows({ ...base, offerings: [
    { kind: "drink", category: "beer", name: "  ", priceCents: 500 },
    { kind: "drink", category: "wine", name: "House Wine", priceCents: null },
  ]});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "House Wine");
  assert.equal(rows[0].priceCents, null);
});

check("non-finite / negative price → null (never crashes the integer insert)", () => {
  const rows = buildAddOfferingRows({ ...base, offerings: [
    { kind: "drink", category: "beer", name: "A", priceCents: Infinity },
    { kind: "drink", category: "beer", name: "B", priceCents: -100 },
  ]});
  assert.equal(rows[0].priceCents, null);
  assert.equal(rows[1].priceCents, null);
});

check("throws without a source url", () => {
  assert.throws(() => buildAddOfferingRows({ happyHourId: "hh1", sourceUrl: "  ", offerings: [{ kind: "drink", category: "beer", name: "A" }] }), /source url/);
});

check("throws when no offering has a name", () => {
  assert.throws(() => buildAddOfferingRows({ ...base, offerings: [{ kind: "drink", category: "beer", name: "  " }] }), /at least one offering/);
});

check("throws without a happyHourId", () => {
  assert.throws(() => buildAddOfferingRows({ happyHourId: "", sourceUrl: "https://x.com", offerings: [{ kind: "drink", category: "beer", name: "A" }] }), /happyHourId/);
});

console.log(`\n${passed} checks passed.`);
