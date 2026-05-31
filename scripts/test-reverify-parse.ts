/**
 * Unit checks for parsing the record_verdict tool call into a typed Verdict.
 * Run: npx tsx scripts/test-reverify-parse.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { parseVerdict } from "@/lib/reverify/adversarial";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

function msgWith(input: unknown) {
  return { content: [{ type: "tool_use", name: "record_verdict", input }] } as never;
}

check("parses a real_window verdict", () => {
  const v = parseVerdict(msgWith({
    kind: "real_window", startTime: "16:00", endTime: "18:00", daysOfWeek: [1, 2, 3, 4, 5],
    quote: "Happy Hour 4-6pm Mon-Fri", sourceUrl: "https://x.com/hh", servesAlcohol: true, reasoning: "r",
  }));
  assert.equal(v?.kind, "real_window");
  assert.equal(v?.kind === "real_window" && v.startTime, "16:00");
});

check("downgrades real_window with no quote to unconfirmable", () => {
  const v = parseVerdict(msgWith({
    kind: "real_window", startTime: "16:00", endTime: "18:00", daysOfWeek: [1],
    quote: "", sourceUrl: "https://x.com", servesAlcohol: true, reasoning: "r",
  }));
  assert.equal(v?.kind, "unconfirmable");
});

check("returns null when no tool call present", () => {
  assert.equal(parseVerdict({ content: [{ type: "text", text: "hi" }] } as never), null);
});

check("downgrades legit_all_day with no quote to unconfirmable", () => {
  const v = parseVerdict(msgWith({
    kind: "legit_all_day", daysOfWeek: [1],
    quote: "", sourceUrl: "https://x.com", servesAlcohol: true, reasoning: "r",
  }));
  assert.equal(v?.kind, "unconfirmable");
});

check("downgrades legit_all_day with no days to unconfirmable", () => {
  const v = parseVerdict(msgWith({
    kind: "legit_all_day", daysOfWeek: [],
    quote: "Monday all day", sourceUrl: "https://x.com", servesAlcohol: true, reasoning: "r",
  }));
  assert.equal(v?.kind, "unconfirmable");
});

check("not_happy_hour passes through without a quote", () => {
  const v = parseVerdict(msgWith({
    kind: "not_happy_hour", quote: "", sourceUrl: "", servesAlcohol: false, reasoning: "just a coupon",
  }));
  assert.equal(v?.kind, "not_happy_hour");
});

check("non-array daysOfWeek does not throw (coerced to empty)", () => {
  const v = parseVerdict(msgWith({
    kind: "real_window", startTime: "16:00", endTime: "18:00", daysOfWeek: 1,
    quote: "HH 4-6", sourceUrl: "https://x.com", servesAlcohol: true, reasoning: "r",
  }));
  assert.equal(v?.kind, "real_window");
  assert.deepEqual(v?.kind === "real_window" && v.daysOfWeek, []);
});

console.log(`\n${passed} checks passed.`);
