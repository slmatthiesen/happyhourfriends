/**
 * Goldens for the schema.org JSON-LD Menu harvester (lib/places/jsonLdMenu).
 * Run: npx tsx scripts/test-jsonld-menu.ts — exits non-zero on any failure.
 *
 * Root case (2026-06-13): Spencer's for Steaks & Chops publishes its full happy-hour
 * menu as JSON-LD (Menu → MenuItem → Offer), but the extractor dropped the <script>,
 * harvestScriptText skipped the bare-token prices, and the model stored a stray "$42"
 * (a Sunday-Supper entrée) at confidence 1.0. This harvester reads the structure.
 */
import assert from "node:assert/strict";
import { parseJsonLdMenuSections, harvestJsonLdMenu } from "@/lib/places/jsonLdMenu";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const wrap = (json: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body>Happy Hour 3-5pm $42</body></html>`;

// Spencer's real shape: a Menu literally named "Happy Hour" with hasMenuItem, offers as
// array (Spinach + add-crab) and as single object. Prices are strings like "12.00".
const SPENCERS = {
  "@context": "https://schema.org",
  "@type": "Menu",
  name: "Happy Hour",
  description: "3 pm - 5 pm. Available in the lounge only, not for take-out",
  hasMenuItem: [
    {
      "@type": "MenuItem",
      name: "Spinach and Artichoke Dip",
      description: "Pita bread",
      offers: [
        { "@type": "Offer", price: "12.00", priceCurrency: "USD" },
        { "@type": "Offer", price: "5.00", priceCurrency: "USD", description: "Add crab" },
      ],
    },
    { "@type": "MenuItem", name: "Roasted Nuts", offers: { "@type": "Offer", price: "5.00", priceCurrency: "USD" } },
    { "@type": "MenuItem", name: "*Prime Bites", description: "6oz prime beef", offers: { "@type": "Offer", price: "19.00", priceCurrency: "USD" } },
    { "@type": "MenuItem", name: "Well Liquor", offers: { "@type": "Offer", price: "8.00", priceCurrency: "USD" } },
    { "@type": "MenuItem", name: "House Wine", offers: { "@type": "Offer", price: "6.50", priceCurrency: "USD" } },
  ],
};

check("Spencer's: finds the Happy Hour section with all items + exact prices", () => {
  const sections = parseJsonLdMenuSections(wrap(SPENCERS));
  const hh = sections.find((s) => s.isHappyHour);
  assert.ok(hh, "expected a happy-hour section");
  assert.equal(hh!.items.length, 5);
  const byName = Object.fromEntries(hh!.items.map((i) => [i.name, i.priceCents]));
  assert.equal(byName["Spinach and Artichoke Dip"], 1200); // first offer, not the $5 add-crab
  assert.equal(byName["Well Liquor"], 800);
  assert.equal(byName["House Wine"], 650);
});

check("Spencer's: harvest text carries names+prices and NEVER the stray $42", () => {
  const text = harvestJsonLdMenu(wrap(SPENCERS));
  assert.ok(text.includes("Spinach and Artichoke Dip"));
  assert.ok(text.includes("$12.00"));
  assert.ok(text.includes("Well Liquor") && text.includes("$8.00"));
  assert.ok(/happy hour/i.test(text));
  assert.ok(!text.includes("$42"), "must not leak the Sunday-Supper entrée price");
});

check("nested Restaurant → hasMenu → Menu → hasMenuSection finds only the HH section", () => {
  const nested = {
    "@type": "Restaurant",
    name: "Some Grill",
    hasMenu: {
      "@type": "Menu",
      hasMenuSection: [
        { "@type": "MenuSection", name: "Dinner", hasMenuItem: [{ "@type": "MenuItem", name: "Ribeye", offers: { price: "42.00" } }] },
        { "@type": "MenuSection", name: "Happy Hour", hasMenuItem: [{ "@type": "MenuItem", name: "Wells", offers: { price: "6" } }] },
      ],
    },
  };
  const text = harvestJsonLdMenu(wrap(nested));
  assert.ok(text.includes("Wells") && text.includes("$6.00"));
  assert.ok(!text.includes("Ribeye"), "non-HH section must be excluded from the harvest");
});

check("HH propagates from an ancestor Menu to a non-HH-named child section (Spencer's real shape)", () => {
  // Real Spencer's: Menu "Happy Hour" → [section "Happy Hour" (food), section "Drink Specials"].
  // The drinks belong to the HH menu even though "Drink Specials" doesn't match HH_RE.
  const real = {
    "@type": "Menu",
    name: "Happy Hour",
    hasMenuSection: [
      { "@type": "MenuSection", name: "Happy Hour", description: "3 pm - 5 pm", hasMenuItem: [{ "@type": "MenuItem", name: "Spinach and Artichoke Dip", offers: { price: "12.00" } }] },
      { "@type": "MenuSection", name: "Drink Specials", hasMenuItem: [{ "@type": "MenuItem", name: "Well Liquor", offers: { price: "8.00" } }, { "@type": "MenuItem", name: "House Wine", offers: { price: "6.50" } }] },
    ],
  };
  const text = harvestJsonLdMenu(wrap(real));
  assert.ok(text.includes("Spinach and Artichoke Dip") && text.includes("$12.00"));
  assert.ok(text.includes("Well Liquor") && text.includes("$8.00"), "drinks under the HH menu must be captured");
  assert.ok(text.includes("House Wine") && text.includes("$6.50"));
});

check("a sibling NON-HH menu is not pulled in by propagation", () => {
  const both = {
    "@type": "Restaurant",
    hasMenu: [
      { "@type": "Menu", name: "Main Menu", hasMenuSection: [{ "@type": "MenuSection", name: "Steaks", hasMenuItem: [{ "@type": "MenuItem", name: "Ribeye", offers: { price: "42" } }] }] },
      { "@type": "Menu", name: "Happy Hour", hasMenuSection: [{ "@type": "MenuSection", name: "Bites", hasMenuItem: [{ "@type": "MenuItem", name: "Fries", offers: { price: "7" } }] }] },
    ],
  };
  const text = harvestJsonLdMenu(wrap(both));
  assert.ok(text.includes("Fries") && text.includes("$7.00"));
  assert.ok(!text.includes("Ribeye"), "the Main Menu must stay out");
});

check("HH detected via section DESCRIPTION when the name is generic", () => {
  const byDesc = {
    "@type": "Menu",
    name: "Specials",
    description: "Our happy hour runs weekdays 4-6pm",
    hasMenuItem: [{ "@type": "MenuItem", name: "Draft", offers: { price: "5" } }],
  };
  const sections = parseJsonLdMenuSections(wrap(byDesc));
  assert.ok(sections.find((s) => s.isHappyHour));
});

check("price formats: '12.00' / '12' / 12 / '$12.50' all parse to cents", () => {
  const mk = (price: unknown) =>
    parseJsonLdMenuSections(
      wrap({ "@type": "Menu", name: "Happy Hour", hasMenuItem: [{ "@type": "MenuItem", name: "X", offers: { price } }] }),
    )[0].items[0].priceCents;
  assert.equal(mk("12.00"), 1200);
  assert.equal(mk("12"), 1200);
  assert.equal(mk(12), 1200);
  assert.equal(mk("$12.50"), 1250);
  assert.equal(mk(null), null);
});

check("@graph array is traversed", () => {
  const graph = { "@context": "https://schema.org", "@graph": [{ "@type": "WebSite" }, SPENCERS] };
  assert.ok(harvestJsonLdMenu(wrap(graph)).includes("Spinach and Artichoke Dip"));
});

check("a non-HH menu alone yields empty harvest (v1 targets HH-named menus)", () => {
  const dinner = { "@type": "Menu", name: "Dinner Menu", hasMenuItem: [{ "@type": "MenuItem", name: "Ribeye", offers: { price: "42" } }] };
  assert.equal(harvestJsonLdMenu(wrap(dinner)), "");
});

check("no JSON-LD on the page → empty, no throw", () => {
  assert.equal(harvestJsonLdMenu("<html><body>Happy Hour 3-5pm</body></html>"), "");
});

check("malformed JSON-LD → empty, never throws", () => {
  const broken = `<script type="application/ld+json">{ "@type": "Menu", name: BROKEN, }</script>`;
  assert.equal(harvestJsonLdMenu(broken), "");
});

check("multiple ld+json blocks: HH menu found even when other blocks are unrelated", () => {
  const html =
    `<script type="application/ld+json">${JSON.stringify({ "@type": "WebSite", name: "x" })}</script>` +
    `<script type="application/ld+json">${JSON.stringify(SPENCERS)}</script>`;
  assert.ok(harvestJsonLdMenu(html).includes("Well Liquor"));
});

console.log(`\n${passed} checks passed.`);
