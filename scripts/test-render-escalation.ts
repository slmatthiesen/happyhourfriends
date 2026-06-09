/**
 * Unit checks for the pure render-escalation detector (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-render-escalation.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { needsRenderEscalation, routeEscalation } from "@/lib/audit/renderEscalation";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// Oeste: triage found /happy-hour-menu (HH-specific) but the free pass read only the homepage
// (the HH page is a JS shell → skipped), and the free windows carry no offerings.
check("oeste: unread HH page → escalate (reason unread_hh_page)", () => {
  const v = needsRenderEscalation({
    confirmedHhUrls: ["https://www.oesteoakland.com/happy-hour-menu", "https://www.oesteoakland.com/menus"],
    readUrls: ["http://www.oesteoakland.com/", "https://www.oesteoakland.com/menus"],
    freeWindows: [{ offerings: [] }, { offerings: [] }],
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "unread_hh_page");
  assert.deepEqual(v.hhPages, ["https://www.oesteoakland.com/happy-hour-menu"]);
});

check("HH page read but free windows have no offerings → escalate (hh_page_no_offerings)", () => {
  const v = needsRenderEscalation({
    confirmedHhUrls: ["https://x.com/happy-hour"],
    readUrls: ["https://x.com/happy-hour"],
    freeWindows: [{ offerings: [] }],
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "hh_page_no_offerings");
});

check("fully captured (HH page read + offerings present) → no escalate", () => {
  const v = needsRenderEscalation({
    confirmedHhUrls: ["https://x.com/happy-hour"],
    readUrls: ["https://x.com/happy-hour"],
    freeWindows: [{ offerings: [{ name: "$5 taco" }] }],
  });
  assert.equal(v.escalate, false);
  assert.equal(v.reason, null);
});

check("no HH-specific page anywhere → no escalate (nothing richer to read)", () => {
  const v = needsRenderEscalation({
    confirmedHhUrls: ["https://x.com/", "https://x.com/about"],
    readUrls: ["https://x.com/"],
    freeWindows: [{ offerings: [] }],
  });
  assert.equal(v.escalate, false);
});

check("stub (no free windows) with an unread HH page → escalate", () => {
  const v = needsRenderEscalation({
    confirmedHhUrls: ["https://x.com/happy-hour-menu"],
    readUrls: ["https://x.com/"],
    freeWindows: null,
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "unread_hh_page");
});

// A CONFIRMED HH page on a denylisted-aggregator host (sirved/restaurantji/etc.) must NOT
// escalate — paying the model to read an aggregator only to have the §13 first-party guard
// reject the result is pure waste. Filtered pre-spend (condition 3).
check("denylisted-aggregator confirmed page → no escalate (skipped pre-spend)", () => {
  const v = needsRenderEscalation({
    confirmedHhUrls: ["https://www.sirved.com/restaurant/oakland/x/happy-hour-specials"],
    readUrls: [],
    freeWindows: null,
  });
  assert.equal(v.escalate, false);
  assert.deepEqual(v.hhPages, []);
});
check("first-party HH page still escalates alongside a denylisted one (only the aggregator is dropped)", () => {
  const v = needsRenderEscalation({
    confirmedHhUrls: ["https://sirved.com/x/happy-hour", "https://realvenue.com/happy-hour-menu"],
    readUrls: [],
    freeWindows: null,
  });
  assert.equal(v.escalate, true);
  assert.deepEqual(v.hhPages, ["https://realvenue.com/happy-hour-menu"]);
});

// --- routeEscalation: phase-2 routing (replaces the blanket forcePaid). Operator policy B:
// PDF/image → paid model (free parser can't read a doc); HTML with a clean STOCKED window →
// take the $0 free parse; otherwise → paid model ("free-parse, then model").
check("PDF page → paid (free parser can't read a doc)", () =>
  assert.equal(routeEscalation([{ url: "x", pdfBase64: "JVBERi0=" }], null), "paid"));
check("image page → paid", () =>
  assert.equal(routeEscalation([{ url: "x", imageBase64: "abc", imageMediaType: "image/jpeg" }], null), "paid"));
check("thin HTML window + a linked PDF → paid (the doc wins; don't short-circuit on the thin window)", () => {
  const pages = [{ url: "h", text: "happy hour 4-6" }, { url: "p", pdfBase64: "JVBERi0=" }];
  assert.equal(routeEscalation(pages, { happyHours: [{ suspect: false, offerings: [] }] }), "paid");
});
check("HTML with a clean stocked window → free ($0)", () => {
  const free = { happyHours: [{ suspect: false, offerings: [{ name: "$5 taco" }] }] };
  assert.equal(routeEscalation([{ url: "h", text: "real menu" }], free), "free");
});
check("HTML, free-parse found nothing → paid (then-model fallback)", () =>
  assert.equal(routeEscalation([{ url: "h", text: "a menu" }], null), "paid"));
check("HTML window with NO offerings → paid (model may read offerings the parser missed)", () =>
  assert.equal(routeEscalation([{ url: "h", text: "hh 4-6" }], { happyHours: [{ suspect: false, offerings: [] }] }), "paid"));
check("HTML, only a SUSPECT stocked window → paid (don't bank a hidden row; let the model try)", () => {
  const free = { happyHours: [{ suspect: true, offerings: [{ name: "$5 taco" }] }] };
  assert.equal(routeEscalation([{ url: "h", text: "x" }], free), "paid");
});
check("no usable pages → skip ($0)", () => {
  assert.equal(routeEscalation([], null), "skip");
  assert.equal(routeEscalation([{ url: "x" }], null), "skip");
});

console.log(`\n✓ ${passed} render-escalation checks passed.`);
