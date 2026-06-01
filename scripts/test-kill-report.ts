/**
 * Runnable unit checks for killReport (no test framework in repo).
 * Run: npx tsx scripts/test-kill-report.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { renderKillReport, type KillEntry } from "@/lib/places/killReport";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const entries: KillEntry[] = [
  { name: "Dead Bar", neighborhood: "Alhambra", reason: "dead", urlTried: "http://dead.com", likelihood: 0.61 },
  { name: "Parked Pub", neighborhood: null, reason: "parked", urlTried: "http://parked.com", likelihood: 0.58 },
  { name: "American Way Pasta", neighborhood: "Ahwatukee", reason: "no_site", urlTried: null, likelihood: 0.56 },
];

check("groups dead/parked under one heading and no-site under another", () => {
  const md = renderKillReport("Phoenix", entries);
  assert.ok(md.includes("Killed: dead / parked sites (2)"));
  assert.ok(md.includes("No site on file — recognize any of these? (1)"));
});
check("renders a table row per entry with likelihood as %", () => {
  const md = renderKillReport("Phoenix", entries);
  assert.ok(md.includes("Dead Bar"));
  assert.ok(md.includes("61%"));
  assert.ok(md.includes("American Way Pasta"));
});
check("empty list still renders headings with (0)", () => {
  const md = renderKillReport("Phoenix", []);
  assert.ok(md.includes("(0)"));
});

console.log(`\n${passed} checks passed.`);
