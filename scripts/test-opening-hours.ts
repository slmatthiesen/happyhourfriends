/**
 * Unit checks for Google regularOpeningHours → ISO OpenPeriod[] parsing.
 * Run: npx tsx scripts/test-opening-hours.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { parseRegularOpeningHours } from "@/lib/places/placeDetails";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("undefined input → null", () => {
  assert.equal(parseRegularOpeningHours(undefined), null);
});

check("empty periods → null", () => {
  assert.equal(parseRegularOpeningHours({ periods: [] }), null);
});

check("Mon 11:00–22:00 maps to ISO day 1, minutes", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 1, hour: 11, minute: 0 }, close: { day: 1, hour: 22, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 1, openMin: 660, closeDay: 1, closeMin: 1320 }]);
});

check("Google Sunday (day 0) maps to ISO 7", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 0, hour: 9, minute: 30 }, close: { day: 0, hour: 14, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 7, openMin: 570, closeDay: 7, closeMin: 840 }]);
});

check("past-midnight close keeps both ISO days", () => {
  // Fri 17:00 → Sat 02:00
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 5, hour: 17, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 5, openMin: 1020, closeDay: 6, closeMin: 120 }]);
});

check("24h venue (open, no close) → closeDay/closeMin null", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 7, openMin: 0, closeDay: null, closeMin: null }]);
});

check("out-of-range Google day is skipped", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 9, hour: 11, minute: 0 }, close: { day: 9, hour: 22, minute: 0 } }],
  });
  assert.equal(out, null);
});

check("partial close (day but no hour) → treated as no close", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 1, hour: 11, minute: 0 }, close: { day: 1 } }],
  });
  assert.deepEqual(out, [{ openDay: 1, openMin: 660, closeDay: null, closeMin: null }]);
});

console.log(`\n${passed} checks passed.`);
