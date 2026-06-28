/**
 * Golden tests for lib/recover/offeringJunk — the three junk classes found in the
 * 2026-06-27 Bistro Amasa audit, plus guards proving each "looks-junky-but-real" pattern
 * from the live data is left alone. Pure logic, no DB — runs in CI.
 */
import assert from "node:assert/strict";
import { classifyOfferingJunk, type OfferingJunkInput } from "@/lib/recover/offeringJunk";

let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function inp(p: Partial<OfferingJunkInput>): OfferingJunkInput {
  return { name: null, priceCents: null, description: null, kind: "drink", ...p };
}

// ── junk: nav-boilerplate ──────────────────────────────────────────────
assert.equal(classifyOfferingJunk(inp({ name: "MENUS RESERVATIONS ABOUT CONTACT" }))?.rule, "nav-boilerplate");
check("flags the Bistro Amasa nav bar");
assert.equal(classifyOfferingJunk(inp({ name: "Order Online" }))?.rule, "nav-boilerplate");
check("flags 'Order Online'");
assert.equal(classifyOfferingJunk(inp({ name: "Reservations" })), null);
check("single nav word is NOT flagged (too thin a signal to be sure)");
assert.equal(classifyOfferingJunk(inp({ name: "Order Online Call Us", priceCents: 1700 }))?.rule, "nav-boilerplate");
check("flags 'Order Online Call Us' CTA strip (Akamaru Scottsdale)");
assert.equal(classifyOfferingJunk(inp({ name: "Call Us Now" }))?.rule, "nav-boilerplate");
check("flags 'Call Us Now' CTA");
assert.equal(classifyOfferingJunk(inp({ name: "Last Call Wells", priceCents: 500 })), null);
check("keeps 'Last Call Wells' (a real late-night drink deal — 'last' isn't chrome)");

// ── junk: bare-soft-drink ──────────────────────────────────────────────
assert.equal(classifyOfferingJunk(inp({ name: "COKE" }))?.rule, "bare-soft-drink");
check("flags bare 'COKE'");
assert.equal(classifyOfferingJunk(inp({ name: "SHRUB SODA Seasonal" }))?.rule, "bare-soft-drink");
check("flags 'SHRUB SODA Seasonal' (descriptor stripped)");
assert.equal(classifyOfferingJunk(inp({ name: "Long Island Iced Tea" })), null);
check("keeps 'Long Island Iced Tea' (whole-name guard)");
assert.equal(classifyOfferingJunk(inp({ name: "Jack & Coke" })), null);
check("keeps 'Jack & Coke' (alcohol token)");
assert.equal(classifyOfferingJunk(inp({ name: "Vodka Strawberry Lemonade" })), null);
check("keeps 'Vodka Strawberry Lemonade' (alcohol token)");
assert.equal(classifyOfferingJunk(inp({ name: "Coke", kind: "food" })), null);
check("does not flag a food-kind item named like a drink");

// ── junk: price-as-name ────────────────────────────────────────────────
assert.equal(classifyOfferingJunk(inp({ name: "$4.00", priceCents: 400 }))?.rule, "price-as-name");
check("flags '$4.00' with no description");
assert.equal(classifyOfferingJunk(inp({ name: "$12", priceCents: 1200 }))?.rule, "price-as-name");
check("flags '$12' with no description");
assert.equal(classifyOfferingJunk(inp({ name: "$5", priceCents: 500, description: "Well drinks" })), null);
check("keeps a price-name when a description carries the deal");

// ── junk: ecommerce-chrome (Central Coast Brewing online-shop scrape) ───
assert.equal(
  classifyOfferingJunk(inp({ name: "Quick View Pete's Pilsner", kind: "drink", priceCents: 1499 }))?.rule,
  "ecommerce-chrome",
);
check("flags 'Quick View Pete's Pilsner' (trailing drink word can't spare it)");
assert.equal(classifyOfferingJunk(inp({ name: "Quick View", kind: "drink", priceCents: 1899 }))?.rule, "ecommerce-chrome");
check("flags bare 'Quick View'");
assert.equal(
  classifyOfferingJunk(inp({ name: "Shop Beer Shop Merch", kind: "drink", priceCents: 1799 }))?.rule,
  "ecommerce-chrome",
);
check("flags 'Shop Beer Shop Merch' (repeated shop nav)");
assert.equal(classifyOfferingJunk(inp({ name: "Add to Cart", kind: "drink" }))?.rule, "ecommerce-chrome");
check("flags 'Add to Cart'");
assert.equal(classifyOfferingJunk(inp({ name: "Sold Out — IPA", kind: "drink" }))?.rule, "ecommerce-chrome");
check("flags 'Sold Out — IPA'");
assert.equal(classifyOfferingJunk(inp({ name: "Shop House Wines", kind: "drink", priceCents: 600 })), null);
check("keeps 'Shop House Wines' (single shop, real deal — only repeated/leading-label fires)");

// ── NOT junk: real patterns from the live data ─────────────────────────
assert.equal(classifyOfferingJunk(inp({ name: null, description: "$2 off beers" })), null);
check("keeps empty name WITH description (description is the deal)");
assert.equal(classifyOfferingJunk(inp({ name: "805", priceCents: 399, description: "Pint" })), null);
check("keeps pure-digit '805' (the Firestone 805 beer)");
assert.equal(classifyOfferingJunk(inp({ name: "Draft Beer", priceCents: 700 })), null);
check("keeps bare category heading 'Draft Beer'");
assert.equal(classifyOfferingJunk(inp({ name: "Corona Non-Alcoholic", priceCents: 400 })), null);
check("keeps 'Corona Non-Alcoholic' (real NA HH deal)");
assert.equal(classifyOfferingJunk(inp({ name: "Zero Proof Drinks", priceCents: 800 })), null);
check("keeps 'Zero Proof Drinks' (real NA HH deal)");
assert.equal(
  classifyOfferingJunk(inp({ name: "Most appetizers (Sliders, Eggrolls, Calamari, Wings)", kind: "food" })),
  null,
);
check("keeps a long item-list paragraph");

console.log(`\n${passed} offeringJunk golden assertions passed.`);
