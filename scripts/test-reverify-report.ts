/**
 * Unit checks for reverify report build + round-trip. Run: npx tsx scripts/test-reverify-report.ts
 */
import assert from "node:assert/strict";
import { buildReportEntries, toJson, parseJson, type ReportEntry } from "@/lib/reverify/report";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const entry: ReportEntry = {
  happyHourId: "hh-1", venueId: "v-1", venueName: "Test Bar", city: "phoenix",
  currentDays: [1, 2, 3, 4, 5], sourceUrl: "https://x.com",
  verdict: { kind: "not_happy_hour", quote: "Coupon", sourceUrl: "https://x.com", servesAlcohol: false, reasoning: "coupon only" },
  action: "delete_venue",
};

check("buildReportEntries pairs a row with its verdict+action", () => {
  const rows = [{ happyHourId: "hh-1", venueId: "v-1", venueName: "Test Bar", city: "phoenix", currentDays: [1, 2, 3, 4, 5], sourceUrl: "https://x.com" }];
  const out = buildReportEntries(rows, [entry.verdict]);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, "delete_venue");
});

check("json round-trips", () => {
  const json = toJson([entry]);
  const back = parseJson(json);
  assert.equal(back[0].action, "delete_venue");
  assert.equal(back[0].verdict.kind, "not_happy_hour");
});

console.log(`\n${passed} checks passed.`);
