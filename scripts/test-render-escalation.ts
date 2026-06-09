/**
 * Unit checks for the pure render-escalation detector (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-render-escalation.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { needsRenderEscalation } from "@/lib/audit/renderEscalation";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// Oeste: triage found /happy-hour-menu (HH-specific) but the free pass read only the homepage
// (the HH page is a JS shell → skipped), and the free windows carry no offerings.
check("oeste: unread HH page → escalate (reason unread_hh_page)", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://www.oesteoakland.com/happy-hour-menu", "https://www.oesteoakland.com/menus"],
    readUrls: ["http://www.oesteoakland.com/", "https://www.oesteoakland.com/menus"],
    freeWindows: [{ offerings: [] }, { offerings: [] }],
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "unread_hh_page");
  assert.deepEqual(v.hhPages, ["https://www.oesteoakland.com/happy-hour-menu"]);
});

check("HH page read but free windows have no offerings → escalate (hh_page_no_offerings)", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/happy-hour"],
    readUrls: ["https://x.com/happy-hour"],
    freeWindows: [{ offerings: [] }],
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "hh_page_no_offerings");
});

check("fully captured (HH page read + offerings present) → no escalate", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/happy-hour"],
    readUrls: ["https://x.com/happy-hour"],
    freeWindows: [{ offerings: [{ name: "$5 taco" }] }],
  });
  assert.equal(v.escalate, false);
  assert.equal(v.reason, null);
});

check("no HH-specific page anywhere → no escalate (nothing richer to read)", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/", "https://x.com/about"],
    readUrls: ["https://x.com/"],
    freeWindows: [{ offerings: [] }],
  });
  assert.equal(v.escalate, false);
});

check("stub (no free windows) with an unread HH page → escalate", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/happy-hour-menu"],
    readUrls: ["https://x.com/"],
    freeWindows: null,
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "unread_hh_page");
});

console.log(`\n✓ ${passed} render-escalation checks passed.`);
