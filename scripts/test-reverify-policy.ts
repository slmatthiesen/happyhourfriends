/**
 * Unit checks for the all-day reverify verdict→action policy.
 * Run: npx tsx scripts/test-reverify-policy.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { recommendAction, type Verdict } from "@/lib/reverify/policy";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const base = { quote: "…", sourceUrl: "https://x.com", servesAlcohol: true, reasoning: "r" };

check("real_window → correct", () =>
  assert.equal(recommendAction({ ...base, kind: "real_window", startTime: "16:00", endTime: "18:00", daysOfWeek: [1, 2, 3, 4, 5] } as Verdict), "correct"));
check("legit_all_day ≤2 days → keep", () =>
  assert.equal(recommendAction({ ...base, kind: "legit_all_day", daysOfWeek: [1, 2] } as Verdict), "keep"));
check("legit_all_day 3+ days → stub (not a real all-day HH)", () =>
  assert.equal(recommendAction({ ...base, kind: "legit_all_day", daysOfWeek: [1, 2, 3] } as Verdict), "stub"));
check("not_happy_hour + not a drinks venue → delete_venue", () =>
  assert.equal(recommendAction({ ...base, servesAlcohol: false, kind: "not_happy_hour" } as Verdict), "delete_venue"));
check("not_happy_hour but drinks venue → stub", () =>
  assert.equal(recommendAction({ ...base, servesAlcohol: true, kind: "not_happy_hour" } as Verdict), "stub"));
check("unconfirmable → stub", () =>
  assert.equal(recommendAction({ ...base, kind: "unconfirmable" } as Verdict), "stub"));
check("legit_all_day with 0 days → stub (degenerate, not keep)", () =>
  assert.equal(recommendAction({ ...base, kind: "legit_all_day", daysOfWeek: [] } as Verdict), "stub"));

console.log(`\n${passed} checks passed.`);
