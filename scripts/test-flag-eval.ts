/**
 * Runnable unit checks for the flag-review eval scorer (lib/audit/flagEval). Pure, $0.
 * Run: pnpm tsx scripts/test-flag-eval.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { evalCases, type FlagLabelCase } from "@/lib/audit/flagEval";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function mkCase(over: Partial<FlagLabelCase> & Pick<FlagLabelCase, "label" | "input">): FlagLabelCase {
  return { city: "testville", venue: "Test Venue", slug: "test-venue", note: null, flagsAtVerdict: [], hiddenWindows: [], ...over };
}

// kept + rules now silent — the HH-page wide-window exemption case: agreement.
// (>6h so the old implausible_active would fire, but <8h and after-11am so the
// operating-hours duration heuristic stays out of the way.)
const keptNowSilent = mkCase({
  label: "kept",
  input: {
    websiteUrl: "https://kept.example.com", hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "14:00:00", endTime: "21:00:00", allDay: false, active: true, sourceUrl: "https://kept.example.com/happy-hour", notes: null }],
  },
});

// kept but rules still flag — a window sourced from a THIRD-PARTY homepage root. Since
// 2026-07-02 a FIRST-party homepage is hard truth (not flagged); homepage_sourced_hh now
// fires only when the homepage is on a foreign domain. A false alarm to mine.
const keptStillFlagged = mkCase({
  label: "kept",
  input: {
    websiteUrl: "https://alarm.example.com", hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, active: true, sourceUrl: "https://aggregator.example.net/", notes: null }],
  },
});

// hidden and rules still flag (>6h from a menu page) — retained catch.
const hiddenStillCaught = mkCase({
  label: "hidden",
  hiddenWindows: ["1|10:00|20:00"],
  input: {
    websiteUrl: "https://caught.example.com", hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "10:00:00", endTime: "20:00:00", allDay: false, active: true, sourceUrl: "https://caught.example.com/menu", notes: null }],
  },
});

// hidden but rules raise nothing (clean-looking window the operator knew was wrong) — regression.
const hiddenNowSilent = mkCase({
  label: "hidden",
  hiddenWindows: ["1,2,3,4,5|16:00|18:00"],
  flagsAtVerdict: [{ code: "stale_event_source", severity: "report", evidence: "was caught once" }],
  input: {
    websiteUrl: "https://lost.example.com", hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://lost.example.com/happy-hour", notes: null }],
  },
});

const report = evalCases([keptNowSilent, keptStillFlagged, hiddenStillCaught, hiddenNowSilent]);

check("kept + silent counts as agreement", () => {
  assert.equal(report.results[0].agrees, true);
  assert.equal(report.results[0].flagsNow.length, 0);
});
check("kept + still-flagged is a disagreement and tallies keptHits per code", () => {
  assert.equal(report.results[1].agrees, false);
  assert.ok(report.perCode["homepage_sourced_hh"].keptHits >= 1);
});
check("hidden + still-flagged counts as a retained catch", () => {
  assert.equal(report.results[2].agrees, true);
  assert.ok(report.perCode["implausible_active"].hiddenHits >= 1);
});
check("hidden + now-silent is a disagreement (lost catch)", () => {
  assert.equal(report.results[3].agrees, false);
  assert.equal(report.results[3].flagsNow.length, 0);
});
check("summary tallies", () => {
  assert.equal(report.keptTotal, 2);
  assert.equal(report.keptSilent, 1);
  assert.equal(report.hiddenTotal, 2);
  assert.equal(report.hiddenCaught, 1);
});

console.log(`\n✓ ${passed} flag-eval checks passed.`);
