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

// --- routeEscalation: phase-2 STRUCTURAL routing (relevance now decided by the Haiku gate).
// free: clean stocked window | paid: doc OR clean-thin window | skip: no content |
// relevance-check: HTML with no clean window — caller asks classifyHhRelevance.
check("route paid: a PDF doc always extracts (single call returns [] on junk)", () =>
  assert.equal(routeEscalation([{ url: "https://v.com/Happy-Hour-Menu.pdf", pdfBase64: "JVBERi0=" }], null), "paid"));
check("route paid: an image doc always extracts", () =>
  assert.equal(routeEscalation([{ url: "https://v.com/menu.jpg", imageBase64: "abc", imageMediaType: "image/jpeg" }], null), "paid"));
check("route paid: a generic dinner-menu PDF also extracts (no filename rule anymore)", () =>
  assert.equal(routeEscalation([{ url: "https://v.com/Dinner-Menu.pdf", pdfBase64: "JVBERi0=" }], null), "paid"));
check("route relevance-check: HTML with no clean window → ask the Haiku gate", () =>
  assert.equal(routeEscalation([{ url: "h", text: "Our cocktail list and spirits." }], null), "relevance-check"));
check("route relevance-check: hotel-package HTML → ask the gate (no URL rule skips it)", () =>
  assert.equal(routeEscalation([{ url: "h", text: "Spa packages and a great dinner." }], null), "relevance-check"));
check("route paid: free parse found a clean but thin (no-offering) window → model finds offerings", () => {
  const pages = [{ url: "h", text: "happy hour 4-6" }];
  assert.equal(routeEscalation(pages, { happyHours: [{ suspect: false, offerings: [] }] }), "paid");
});
check("route free: free parse found a clean stocked window → $0", () => {
  const free = { happyHours: [{ suspect: false, offerings: [{}] }] };
  assert.equal(routeEscalation([{ url: "h", text: "real menu" }], free), "free");
});
check("route paid: suspect-only free window is ignored; a doc still extracts", () => {
  const free = { happyHours: [{ suspect: true, offerings: [{}] }] };
  assert.equal(routeEscalation([{ url: "h", pdfBase64: "JVBERi0=" }], free), "paid");
});
check("route relevance-check: suspect-only free window + HTML → ask the gate (never escalate on noise)", () => {
  const free = { happyHours: [{ suspect: true, offerings: [{}] }] };
  assert.equal(routeEscalation([{ url: "h", text: "Spa packages and dining specials." }], free), "relevance-check");
});
check("route skip: no usable content", () => {
  assert.equal(routeEscalation([], null), "skip");
  assert.equal(routeEscalation([{ url: "x" }], null), "skip");
});

console.log(`\n✓ ${passed} render-escalation checks passed.`);
