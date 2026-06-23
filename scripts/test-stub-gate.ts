/**
 * test-stub-gate — hermetic checks for the dead-end-stub predicate (Build A) that decides which
 * venues get hidden from the public list, and its inverse isHhLikely (gates the paid Jina tier).
 * Run: tsx scripts/test-stub-gate.ts
 */
import assert from "node:assert/strict";
import {
  ZERO_HH_TYPES,
  passesAlcoholGate,
  isDeadEndSignal,
  isHhLikely,
  isDeadEndStub,
  type AlcoholTypeSignal,
} from "@/lib/places/stubGate";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const sig = (s: Partial<AlcoholTypeSignal>): AlcoholTypeSignal => ({
  servesAlcohol: null, name: null, primaryType: null, types: null, ...s,
});

check("ZERO_HH_TYPES is exactly korean/vietnamese/chinese (taco/hawaiian deliberately excluded)", () => {
  assert.deepEqual([...ZERO_HH_TYPES].sort(), ["chinese_restaurant", "korean_restaurant", "vietnamese_restaurant"]);
  assert.ok(!ZERO_HH_TYPES.has("mexican_restaurant"));
  assert.ok(!ZERO_HH_TYPES.has("hawaiian_restaurant"));
});

check("alcohol gate: explicit serves_alcohol=false with no override fails", () => {
  assert.equal(passesAlcoholGate(sig({ servesAlcohol: false, primaryType: "restaurant", name: "Pho 88" })), false);
});

check("alcohol gate: serves_alcohol=false but a bar-type/name OVERRIDES (never drop a real bar)", () => {
  assert.equal(passesAlcoholGate(sig({ servesAlcohol: false, name: "The Tap Room", primaryType: "restaurant" })), true);
  assert.equal(passesAlcoholGate(sig({ servesAlcohol: false, primaryType: "bar", name: "Joe's" })), true);
});

check("alcohol gate: null serves_alcohol passes (unknown never gates out)", () => {
  assert.equal(passesAlcoholGate(sig({ servesAlcohol: null, primaryType: "restaurant", name: "Somewhere" })), true);
});

check("dead-end signal: no-alcohol restaurant is a dead end", () => {
  assert.equal(isDeadEndSignal(sig({ servesAlcohol: false, primaryType: "restaurant", name: "Tea House" })), true);
});

check("dead-end signal: zero-HH cuisine is a dead end even WITH alcohol", () => {
  assert.equal(isDeadEndSignal(sig({ servesAlcohol: true, primaryType: "vietnamese_restaurant", name: "Pho Bar" })), true);
  assert.equal(isDeadEndSignal(sig({ servesAlcohol: null, primaryType: "korean_restaurant", name: "KBBQ" })), true);
});

check("NOT a dead end: an alcohol-serving bar / American / seafood", () => {
  assert.equal(isDeadEndSignal(sig({ servesAlcohol: true, primaryType: "bar", name: "Nowhere Bar" })), false);
  assert.equal(isDeadEndSignal(sig({ servesAlcohol: true, primaryType: "american_restaurant", name: "Grill" })), false);
});

check("NOT a dead end: a bot-walled `restaurant` with alcohol (Rise Woodfire) is HH-likely, never hidden", () => {
  const rise = sig({ servesAlcohol: true, primaryType: "restaurant", name: "Rise Woodfire Pizza" });
  assert.equal(isDeadEndSignal(rise), false);
  assert.equal(isHhLikely(rise), true);
});

check("NOT a dead end: a curated venue with NO candidate signal (all null) — safe default", () => {
  assert.equal(isDeadEndSignal(sig({})), false);
  assert.equal(isHhLikely(sig({})), true);
});

check("isHhLikely is the exact complement of isDeadEndSignal", () => {
  for (const s of [
    sig({ servesAlcohol: false, primaryType: "restaurant" }),
    sig({ servesAlcohol: true, primaryType: "chinese_restaurant" }),
    sig({ servesAlcohol: true, primaryType: "bar" }),
    sig({}),
  ]) assert.equal(isHhLikely(s), !isDeadEndSignal(s));
});

check("isDeadEndStub: a venue WITH an active HH is never a dead end (even no-alcohol)", () => {
  assert.equal(
    isDeadEndStub({ hasActiveHappyHour: true, signal: sig({ servesAlcohol: false, primaryType: "vietnamese_restaurant" }) }),
    false,
  );
});

check("isDeadEndStub: HH-less + dead-end signal IS a dead end", () => {
  assert.equal(
    isDeadEndStub({ hasActiveHappyHour: false, signal: sig({ servesAlcohol: false, primaryType: "restaurant" }) }),
    true,
  );
});

console.log(`\n${passed} checks passed.`);
