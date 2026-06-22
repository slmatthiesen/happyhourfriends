/**
 * Unit checks for salvaging a mis-typed record_happy_hours tool call, where the model
 * returns `happyHours` as a STRING instead of an array (Bourbon & Bones: a fully-correct
 * extraction — 2 windows / 16 offerings / conf 0.92 — was silently recorded as zero).
 * Run: pnpm tsx scripts/test-extract-salvage.ts
 */
import assert from "node:assert/strict";
import { normaliseRawExtract, salvageStringifiedExtract } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const WIN = '{"daysOfWeek":[1,2,3,4,5],"startTime":"16:00","endTime":"18:00","sourceUrl":"https://x.com/hh","offerings":[{"kind":"drink","category":"cocktail","name":"Chophouse Martini","priceCents":1200,"sourceUrl":"https://x.com/hh"}]}';

check("inner-content string (the Bourbon & Bones shape) is re-wrapped and recovered", () => {
  // The model emitted everything AFTER `"happyHours":` as one string value.
  const raw = { happyHours: `[${WIN}],"summary":"Mon-Fri 4-6pm bar","confidence":0.92,"venueType":"bar"` as unknown as never };
  const r = normaliseRawExtract(raw);
  assert.equal(r.rawWindowCount, 1);
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].startTime, "16:00");
  assert.equal(r.happyHours[0].offerings.length, 1);
  assert.equal(r.confidence, 0.92);            // sibling fields salvaged too
  assert.equal(r.summary, "Mon-Fri 4-6pm bar");
  assert.equal(r.venueType, "bar");
});

check("bare JSON-array string is parsed", () => {
  const raw = { happyHours: `[${WIN}]` as unknown as never };
  const r = normaliseRawExtract(raw);
  assert.equal(r.happyHours.length, 1);
});

check("leading balanced array with trailing junk is extracted", () => {
  const raw = { happyHours: `[${WIN}]  ...trailing model chatter that isn't JSON` as unknown as never, confidence: 0.5 };
  const r = normaliseRawExtract(raw);
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.confidence, 0.5);             // falls back to the raw field
});

check("a normal array is untouched", () => {
  const r = normaliseRawExtract({ happyHours: [JSON.parse(WIN)], confidence: 0.8, summary: "ok" });
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.confidence, 0.8);
});

check("genuinely unsalvageable string → empty, no throw", () => {
  const raw = { happyHours: "no json here at all" as unknown as never };
  const r = normaliseRawExtract(raw);
  assert.equal(r.rawWindowCount, 0);
  assert.equal(r.happyHours.length, 0);
});

check("salvageStringifiedExtract leaves a valid array object identical", () => {
  const valid = { happyHours: [JSON.parse(WIN)], confidence: 0.7, summary: "x", venueType: null };
  assert.equal(salvageStringifiedExtract(valid), valid);
});

console.log(`\n✓ extract-salvage: ${passed} checks passed.`);
