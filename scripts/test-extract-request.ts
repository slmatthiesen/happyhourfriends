/**
 * Runnable check: buildExtractRequest renders priorityUrls into the user message.
 * Run: npx tsx scripts/test-extract-request.ts — exits non-zero on failure.
 */
import assert from "node:assert/strict";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

function userText(req: ReturnType<typeof buildExtractRequest>): string {
  const msg = req.params.messages[0];
  return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
}

check("priority urls are listed when provided", () => {
  const req = buildExtractRequest({
    venueName: "Brix", websiteUrl: "http://brix.com", otherUrl: null, cityName: "Phoenix",
    priorityUrls: ["http://brix.com/happy-hour", "http://brix.com/menus"],
  });
  const t = userText(req);
  assert.ok(t.includes("http://brix.com/happy-hour"));
  assert.ok(t.includes("http://brix.com/menus"));
});

check("renders 'none' when no priority urls", () => {
  const req = buildExtractRequest({ venueName: "Brix", websiteUrl: "http://brix.com", otherUrl: null, cityName: "Phoenix" });
  assert.ok(userText(req).toLowerCase().includes("none"));
});

console.log(`\n${passed} checks passed.`);
