/**
 * Runnable unit checks for parseHappyHours (no test framework in repo).
 * Run: pnpm tsx scripts/test-parse-hh-text.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { parseHappyHours, type ParsedWindow } from "@/lib/places/parseHhText";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
const URL = "https://x.com/hh";
const clean = (ws: ParsedWindow[]) => ws.filter((w) => w.confidence === "clean");
const win = (ws: ParsedWindow[], i = 0) => clean(ws)[i];

// --- POSITIVES (must produce a clean window) ---
check("'Happy Hour: 3pm-7pm daily' → [1..7] 15:00-19:00", () => {
  const w = win(parseHappyHours("Happy Hour: 3pm-7pm daily", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "19:00");
  assert.equal(w.confidence, "clean");
});
check("'Happy Hour 11pm-2am Sunday through Thursday' → Sun-Thu cross-midnight", () => {
  const w = win(parseHappyHours("Happy Hour 11pm-2am Sunday through Thursday", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 7]); // sorted: Mon..Thu + Sun
  assert.equal(w.startTime, "23:00");
  assert.equal(w.endTime, "02:00");
});
check("'Mon-Fri 3pm-6pm' → [1..5]", () => {
  const w = win(parseHappyHours("Happy hour Mon-Fri 3pm-6pm", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "18:00");
});
check("'happy hour 3-7' (no meridiem, HH context) → pm inferred 15:00-19:00", () => {
  const w = win(parseHappyHours("Happy hour 3-7", URL));
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "19:00");
});
check("'Happy hour 9pm-close' → start set, end null", () => {
  const w = win(parseHappyHours("Happy hour 9pm-close daily", URL));
  assert.equal(w.startTime, "21:00");
  assert.equal(w.endTime, null);
  assert.equal(w.timeKnown, true);
});
check("time but NO days + HH context → assume Mon-Fri, note it", () => {
  const w = win(parseHappyHours("Happy hour 4pm-6pm", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.match(w.notes ?? "", /assumed Mon.Fri/i);
});
check("attached offering parsed: '$1 off menu cocktails'", () => {
  const w = win(parseHappyHours("Happy hour Mon-Fri 3-6pm: $1 off menu cocktails", URL));
  assert.ok(w.offerings.length >= 1);
  assert.equal(w.offerings[0].kind, "drink");
  assert.equal(w.offerings[0].discountCents, 100);
});
check("two windows on one page both parse", () => {
  const ws = clean(parseHappyHours("Happy Hour 3-6pm and 9pm-close, Mon-Fri", URL));
  assert.equal(ws.length, 2);
});
check("sourceUrl + evidence carried", () => {
  const w = win(parseHappyHours("Happy Hour: 3pm-7pm daily", URL));
  assert.equal(w.sourceUrl, URL);
  assert.match(w.evidence, /3pm-7pm/);
});

// --- NEGATIVES (must NOT produce a clean window → escalate) ---
check("HH wording but NO time → 0 clean", () => {
  assert.equal(clean(parseHappyHours("We have the best happy hour in town!", URL)).length, 0);
});
check("'happy hour all day Monday' (no time bound) → 0 clean", () => {
  assert.equal(clean(parseHappyHours("Happy hour all day Monday", URL)).length, 0);
});
check("bare '3-7' with NO happy-hour/deal context → 0 clean", () => {
  assert.equal(clean(parseHappyHours("Open 3-7 for lunch service", URL)).length, 0);
});
check("empty text → []", () => {
  assert.deepEqual(parseHappyHours("", URL), []);
});

console.log(`\n${passed} checks passed.`);
