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
check("escapes pipes in venue name so the table row stays intact", () => {
  const md = renderKillReport("Phoenix", [
    { name: "Bar | Grill", neighborhood: "X|Y", reason: "dead", urlTried: "http://a.com?x=1|2", likelihood: 0.5 },
  ]);
  assert.ok(md.includes("Bar \\| Grill"));
  assert.ok(md.includes("X\\|Y"));
  // The data row has exactly 5 columns → 6 pipes (leading, 4 separators, trailing).
  const dataRow = md.split("\n").find((l) => l.includes("Bar \\| Grill"))!;
  assert.equal((dataRow.match(/(?<!\\)\|/g) ?? []).length, 6);
});

console.log(`\n${passed} checks passed.`);
