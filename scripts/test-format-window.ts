/**
 * Unit checks for formatWindow display. Run: npx tsx scripts/test-format-window.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { formatWindow } from "@/lib/format";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("bounded window renders both sides", () =>
  assert.equal(formatWindow({ allDay: false, startTime: "16:00", endTime: "18:00" }), "4 PM – 6 PM"));

check("until-close renders start – close", () =>
  assert.equal(formatWindow({ allDay: false, startTime: "22:00", endTime: null }), "10 PM – close"));

check("all-day renders Open to close", () =>
  assert.equal(formatWindow({ allDay: true, startTime: null, endTime: null }), "Open to close"));

check("open-until-X (start null, end set) renders 'Until <end>'", () =>
  assert.equal(formatWindow({ allDay: false, startTime: null, endTime: "18:00" }), "Until 6 PM"));

console.log(`\n${passed} checks passed.`);
