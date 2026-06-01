/**
 * Checks that normaliseOp accepts the new `new_happy_hour` action and passes its
 * after blob through. Run: npx tsx scripts/test-interpreter-newhh.ts
 */
import assert from "node:assert/strict";
import { normaliseOp, INTERPRET_ACTIONS } from "@/lib/ai/interpreter";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("new_happy_hour is an allowed action", () =>
  assert.ok((INTERPRET_ACTIONS as readonly string[]).includes("new_happy_hour")));

check("normaliseOp keeps a new_happy_hour op with days+start+offerings", () => {
  const op = normaliseOp({
    action: "new_happy_hour",
    targetId: null,
    after: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "15:00",
      endTime: "18:00",
      offerings: [{ kind: "drink", category: "beer", name: "Drafts", priceCents: 400 }],
    },
    summary: "Add weekday 3-6 happy hour",
    confidence: 0.9,
  });
  assert.ok(op);
  assert.equal(op!.action, "new_happy_hour");
  assert.deepEqual((op!.after as Record<string, unknown>).daysOfWeek, [1, 2, 3, 4, 5]);
});

check("an unknown action is still dropped", () =>
  assert.equal(normaliseOp({ action: "delete_everything", after: {}, summary: "", confidence: 1 }), null));

console.log(`\n${passed} checks passed.`);
