/**
 * test-plan-supersede — hermetic unit checks for planBareSupersedes (lib/recover/
 * supersedeBareWindows): the pure decision for which BARE windows a venue's richer
 * windows make redundant. Never returns a window that carries offerings (never removes
 * good data); only retires a bare window when its every day+time is fully covered by a
 * deal-carrying window (Rule 1) or it is a redundant specific-area copy of a bare 'all'
 * window (Rule 2). Run: tsx scripts/test-plan-supersede.ts
 */
import assert from "node:assert/strict";
import { planBareSupersedes, type SupersedeWindow } from "@/lib/recover/supersedeBareWindows";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

let n = 0;
const w = (p: Partial<SupersedeWindow>): SupersedeWindow => ({
  id: `w${n++}`, daysOfWeek: [1], startTime: "16:00:00", endTime: "18:00:00",
  allDay: false, location: "all", offeringCount: 0, ...p,
});
const retired = (wins: SupersedeWindow[]) => planBareSupersedes(wins);

check("Scenario A (existing): priced 'bar' supersedes same-time bare 'all'", () => {
  const bareAll = w({ id: "bareAll", daysOfWeek: [1, 2, 3, 4], startTime: "14:00:00", endTime: "17:00:00", location: "all" });
  const barDeals = w({ id: "barDeals", daysOfWeek: [1, 2, 3, 4], startTime: "14:00:00", endTime: "17:00:00", location: "bar", offeringCount: 3 });
  const r = retired([bareAll, barDeals]);
  assert.ok(r.has("bareAll"), "bare 'all' retired");
  assert.ok(!r.has("barDeals"), "priced 'bar' kept");
});

check("distinct priced areas coexist; lonely bare with no sibling survives", () => {
  const patio = w({ id: "patio", daysOfWeek: [5], location: "patio", offeringCount: 2 });
  const dining = w({ id: "dining", daysOfWeek: [5], location: "dining", offeringCount: 2 });
  const lonely = w({ id: "lonely", daysOfWeek: [6], startTime: "15:00:00", endTime: "17:00:00" });
  const r = retired([patio, dining, lonely]);
  assert.equal(r.size, 0);
});

check("LOCAL: bare all-week is FULLY covered by two deal windows → retired", () => {
  const bare = w({ id: "bare", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "16:00:00", endTime: "18:00:00" });
  const mw = w({ id: "mw", daysOfWeek: [1, 2, 3], startTime: "16:00:00", endTime: "18:00:00", offeringCount: 16 });
  const ts = w({ id: "ts", daysOfWeek: [4, 5, 6, 7], startTime: "15:00:00", endTime: "18:00:00", offeringCount: 20 });
  const r = retired([bare, mw, ts]);
  assert.ok(r.has("bare"), "fully-covered bare retired");
  assert.ok(!r.has("mw") && !r.has("ts"), "deal windows kept");
});

check("PARTIAL coverage does NOT retire (never drop confirmed days/times)", () => {
  // Only Mon-Wed has deals; the bare all-week window still asserts Thu-Sun 16-18 → keep it.
  const bare = w({ id: "bare", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "16:00:00", endTime: "18:00:00" });
  const mw = w({ id: "mw", daysOfWeek: [1, 2, 3], startTime: "16:00:00", endTime: "18:00:00", offeringCount: 16 });
  const r = retired([bare, mw]);
  assert.ok(!r.has("bare"), "partially-covered bare must survive");
});

check("Finney's: bare Mon ⊂ deal Mon-Fri same time → retired (subset coverage)", () => {
  const bareMon = w({ id: "bareMon", daysOfWeek: [1], startTime: "15:00:00", endTime: "17:00:00" });
  const mf = w({ id: "mf", daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00:00", endTime: "17:00:00", offeringCount: 27 });
  const r = retired([bareMon, mf]);
  assert.ok(r.has("bareMon") && !r.has("mf"));
});

check("a deal window must CONTAIN the bare time, not merely touch it", () => {
  // bare 14-18; deal only 16-17 (narrower) → does not cover → keep bare.
  const bare = w({ id: "bare", startTime: "14:00:00", endTime: "18:00:00" });
  const narrow = w({ id: "narrow", startTime: "16:00:00", endTime: "17:00:00", offeringCount: 5 });
  const r = retired([bare, narrow]);
  assert.ok(!r.has("bare"));
});

check("Arnoldi's: bare specific-area copy of a bare 'all' twin → specific retired, 'all' kept", () => {
  const bareAll = w({ id: "bareAll", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "16:00:00", endTime: "17:00:00", location: "all" });
  const bareBar = w({ id: "bareBar", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "16:00:00", endTime: "17:00:00", location: "bar" });
  const r = retired([bareAll, bareBar]);
  assert.ok(r.has("bareBar"), "redundant specific bare copy retired");
  assert.ok(!r.has("bareAll"), "broader 'all' kept");
});

check("never retires a window that carries offerings (no good-data loss)", () => {
  const dealA = w({ id: "dealA", daysOfWeek: [1], startTime: "16:00:00", endTime: "18:00:00", offeringCount: 4 });
  const dealB = w({ id: "dealB", daysOfWeek: [1], startTime: "16:00:00", endTime: "18:00:00", offeringCount: 9, location: "bar" });
  const r = retired([dealA, dealB]);
  assert.equal(r.size, 0, "two deal-carrying windows are never auto-retired here");
});

check("a 'patio' deal does NOT supersede an 'all' bare (different specific area)", () => {
  const bareAll = w({ id: "bareAll", daysOfWeek: [5], startTime: "16:00:00", endTime: "18:00:00", location: "patio" });
  const dining = w({ id: "dining", daysOfWeek: [5], startTime: "16:00:00", endTime: "18:00:00", location: "dining", offeringCount: 3 });
  const r = retired([bareAll, dining]);
  assert.equal(r.size, 0, "distinct specific areas never supersede each other");
});

console.log(`\n${passed} checks passed.`);
