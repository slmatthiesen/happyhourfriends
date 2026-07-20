/**
 * Golden tests for lib/notes/publicNote — the restriction-only gate for happy-hour notes.
 * Cases are drawn from the live prod `happy_hours.notes` survey (2026-07-20): the notes we
 * KEEP are genuine access restrictions; everything else (labels, restatements of the window
 * or offerings, and internal provenance markers) is HIDDEN. Pure logic, no DB — runs in CI.
 */
import assert from "node:assert/strict";
import { publicNote } from "@/lib/notes";

let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── KEEP: real access / redemption restrictions ────────────────────────
for (const keep of [
  "21+ only",
  "Dine-in only",
  "Dine in only",
  "For dine-in only",
  "Dine-In Only for food items",
  "Bar Only",
  "No To Go's; Bar Only",
  "In-store only",
  "In-restaurant dining only",
  "Available at Cupertino, Los Gatos, Mountain View, Palo Alto, SF locations only",
  "Happy hour available in lounge only. Not valid on holidays.",
  "Sunday happy hour at San Carlos location only (3:00–5:00pm)",
  "Burger Night (dine in only)",
]) {
  assert.equal(publicNote(keep), keep, `should KEEP: ${keep}`);
  check(`keeps "${keep}"`);
}

// ── HIDE: labels, restatements, provenance markers, promo names ────────
for (const hide of [
  "days assumed Mon–Fri (none stated)", // internal parser marker (24 live pages)
  "No itemized pricing provided on the page",
  "operator-confirmed recurring HH",
  "recorded as stated window",
  "Happy Hour",
  "Daily happy hour",
  "Hoppy Hour",
  "Aperitivo Hour",
  "Happy hour pricing on drinks",
  "Happy Hour Monday–Friday 2–5PM.", // restates the structured window
  "last hour also included", // real extra period, but prose — belongs in a window, not a note
  "Late Night Happy Hour",
  "until close",
  "Two-for-one on spirits", // restates an offering
  "50% off food, wine by the glass, and draught beer",
  "Taco Tuesday", // promo name (still the grid all-day badge label — that path is separate)
  "Wing Wednesday: $2 off all orders of chicken wings",
  "Excluding holidays",
  "Jeopardy Bar League", // contains "Bar" but is not a bar-only restriction
]) {
  assert.equal(publicNote(hide), null, `should HIDE: ${hide}`);
  check(`hides "${hide}"`);
}

// ── empty / nullish ────────────────────────────────────────────────────
assert.equal(publicNote(null), null);
assert.equal(publicNote(undefined), null);
assert.equal(publicNote("   "), null);
check("empty / null / whitespace → null");

console.log(`\n${passed} checks passed`);
