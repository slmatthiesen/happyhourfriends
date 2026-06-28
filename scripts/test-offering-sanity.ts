/**
 * Golden tests for lib/recover/offeringSanity — cases lifted verbatim from the
 * 2026-06-10 operator flag review (Bistro 44 + Backyard Public House garbling)
 * plus guards against over-correction. Pure logic, no DB — runs in CI.
 * Also covers the sourceDenylist additions from the same review.
 */
import assert from "node:assert/strict";
import { sanitizeOfferings, offeringNameKey, classifyStoredOffering } from "@/lib/recover/offeringSanity";
import type { ExtractedOffering } from "@/lib/ai/extractHappyHours";
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";

let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function off(partial: Partial<ExtractedOffering>): ExtractedOffering {
  return {
    kind: "drink",
    category: "other",
    name: null,
    priceCents: null,
    originalPriceCents: null,
    discountCents: null,
    discountPercent: null,
    description: null,
    conditions: null,
    sourceUrl: "https://example.com",
    ...partial,
  };
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

// ── Bistro 44 golden: duplicate food-as-drink rows ──────────────────────────
{
  const r = sanitizeOfferings(
    [
      off({ kind: "drink", name: "$1 Off All Drinks" }),
      off({ kind: "drink", name: "$3 Off All Appetizers Open Daily" }),
      off({ kind: "drink", name: "Half Priced Burgers on Sunday" }),
      off({ kind: "drink", name: "Half Priced Burgers on Sunday" }),
    ],
    EVERY_DAY,
  );
  assert.equal(r.offerings.length, 3);
  check("Bistro 44: exact duplicate offering dropped");
  const burgers = r.offerings.find((o) => o.name?.includes("Burgers"));
  assert.equal(burgers?.kind, "food");
  check("Bistro 44: 'Half Priced Burgers' re-kinded drink→food");
  const apps = r.offerings.find((o) => o.name?.includes("Appetizers"));
  assert.equal(apps?.kind, "food");
  assert.equal(apps?.category, "appetizer");
  check("Bistro 44: 'All Appetizers' re-kinded with category=appetizer");
  const drinks = r.offerings.find((o) => o.name === "$1 Off All Drinks");
  assert.equal(drinks?.kind, "drink");
  check("Bistro 44: real drink offering left untouched");
  assert.ok(
    r.warnings.some((w) => w.includes("day-specific") && w.includes("Burgers")),
    `expected day-specific warning, got: ${r.warnings.join(" / ")}`,
  );
  check("Bistro 44: Sunday-only item in an every-day window warned");
}

// ── Backyard Public House golden: food kinded as beer, day-specials merged ──
{
  const r = sanitizeOfferings(
    [
      off({ kind: "drink", category: "beer", name: "$10 All Shareables Happy Hour", priceCents: 1000 }),
      off({ kind: "drink", category: "beer", name: "$10 Backyard Burger Tuesday Happy", priceCents: 1000 }),
      off({ kind: "drink", category: "beer", name: "$12 Riverside Tacos", priceCents: 1200 }),
      off({ kind: "drink", category: "beer", name: "$14 Wing Central", priceCents: 1400 }),
      off({ kind: "drink", category: "beer", name: "$1 off draft beers" }),
      off({ kind: "drink", category: "beer", name: "$5 Wells", priceCents: 500 }),
    ],
    EVERY_DAY,
  );
  // Names below are post-strip: the redundant "$N " absolute-price prefix is removed
  // (price_cents carries it); "$1 off draft beers" keeps its prefix (discount, null price).
  const kinds = Object.fromEntries(r.offerings.map((o) => [o.name, o.kind]));
  assert.equal(kinds["All Shareables Happy Hour"], "food");
  assert.equal(kinds["Backyard Burger Tuesday Happy"], "food");
  assert.equal(kinds["Riverside Tacos"], "food");
  assert.equal(kinds["Wing Central"], "food");
  check("Backyard: shareables/burger/tacos/wings all re-kinded drink→food");
  assert.equal(kinds["$1 off draft beers"], "drink");
  assert.equal(kinds["Wells"], "drink");
  check("Backyard: drafts and wells stay drink");
  assert.ok(r.warnings.some((w) => w.includes("day-specific") && w.includes("Tuesday")));
  check("Backyard: Tuesday special merged into the weekly window warned");
}

// ── Over-correction guards ───────────────────────────────────────────────────
{
  const r = sanitizeOfferings(
    [
      off({ kind: "drink", name: "Moscow Mule", priceCents: 800 }),
      // Mixed food+drink wording must NOT re-kind (ambiguous).
      off({ kind: "drink", name: "Beer & Wings Combo", priceCents: 1200 }),
      // Day token matching the window's single day is fine — no warning.
    ],
    EVERY_DAY,
  );
  assert.equal(r.offerings[0].kind, "drink");
  assert.equal(r.offerings[1].kind, "drink");
  assert.equal(r.warnings.length, 0);
  check("ambiguous/mixed wording never re-kinds; no spurious warnings");

  const single = sanitizeOfferings(
    [off({ kind: "food", name: "Taco Tuesday platter", priceCents: 900 })],
    [2],
  );
  assert.equal(single.warnings.length, 0);
  check("day token matching a single-day window doesn't warn");

  const sameSet = sanitizeOfferings(
    [off({ kind: "food", name: "Saturday & Sunday brunch bites" })],
    [6, 7],
  );
  assert.equal(sameSet.warnings.length, 0);
  check("named days equal to the window's day-set doesn't warn");
}

// ── sourceDenylist additions (2026-06-10 flag review) ───────────────────────
{
  for (const url of [
    "https://cheerhop.com/tacoma/wooden-city-tacoma",
    "https://www.thehappyhourfinder.com/spot/123",
    "https://happyhourmaps.com/phoenix",
    "https://tacotuesday.com/venues/el-paso",
    "https://www.usmenuguide.com/some-bar.html",
  ]) {
    assert.equal(isDenylistedSource(url), true, `should be denylisted: ${url}`);
  }
  check("new aggregator domains are denylisted");
  for (const url of [
    "https://www.woodennickeltavern.com/",
    "https://eatwoven.com/menus/",
    // A venue's own /taco-tuesday PAGE must not trip the tacotuesday.com entry.
    "https://someborracho.com/taco-tuesday",
  ]) {
    assert.equal(isDenylistedSource(url), false, `should NOT be denylisted: ${url}`);
  }
  check("venue-own pages (incl. /taco-tuesday paths) stay allowed");
}

// ── offeringNameKey dedupe identity (Backyard re-extract dupes, 2026-06-10) ──
{
  assert.equal(offeringNameKey("$5 Wells"), offeringNameKey("Wells"));
  assert.equal(offeringNameKey("All shareables"), offeringNameKey("All Shareables"));
  assert.equal(offeringNameKey("$2 off  Tequila Pours"), offeringNameKey("tequila pours"));
  assert.notEqual(offeringNameKey("Draft beers"), offeringNameKey("Well drinks"));
  check("offeringNameKey: case/price-prefix variants collapse, distinct deals don't");

  const r = sanitizeOfferings(
    [
      off({ kind: "drink", name: "$5 Wells", priceCents: 500 }),
      off({ kind: "drink", name: "Wells", priceCents: 500 }),
    ],
    EVERY_DAY,
  );
  assert.equal(r.offerings.length, 1);
  check("'$5 Wells' + 'Wells' at the same price dedupe to one row");
}

// ── implausible price WARNINGS (diagnosis bucket #3) — warn only, never hide ──
{
  // Wooden Nickel: $2 wells/drafts — implausibly cheap (floor is universal, no tier needed).
  const cheap = sanitizeOfferings([off({ kind: "drink", name: "$2 Well Drinks", priceCents: 200 })], EVERY_DAY);
  assert.ok(cheap.warnings.some((w) => /cheap|implausible/i.test(w)), `expected cheap-price warning, got: ${cheap.warnings.join(" / ")}`);
  check("Wooden Nickel: $2 well drink warns (implausibly cheap)");

  // A normal $5 well does NOT warn.
  const ok5 = sanitizeOfferings([off({ kind: "drink", name: "$5 Wells", priceCents: 500 })], EVERY_DAY);
  assert.equal(ok5.warnings.length, 0);
  check("$5 well drink does not warn");

  // Quesadilla Gorilla: $15-16 cocktail at a casual venue (priceLevel ≤ 2) = full-price scrape → warn.
  const casualHigh = sanitizeOfferings(
    [off({ kind: "drink", category: "cocktail", name: "Oaxaca Old Fashioned", priceCents: 1600 })],
    EVERY_DAY,
    { priceLevel: 1 },
  );
  assert.ok(casualHigh.warnings.some((w) => /high|implausible/i.test(w)), `expected high-price warning, got: ${casualHigh.warnings.join(" / ")}`);
  check("Quesadilla Gorilla: $16 cocktail at a casual (priceLevel 1) venue warns");

  // Same $15 cocktail at an UPSCALE venue (priceLevel 4) is plausible → no warn (Maple & Ash).
  const upscale = sanitizeOfferings(
    [off({ kind: "drink", category: "cocktail", name: "Select cocktails", priceCents: 1500 })],
    EVERY_DAY,
    { priceLevel: 4 },
  );
  assert.equal(upscale.warnings.length, 0);
  check("Maple & Ash: $15 cocktail at priceLevel 4 does NOT warn");

  // High price with NO priceLevel known → no high-warn (the ceiling needs tier context).
  const noTier = sanitizeOfferings(
    [off({ kind: "drink", category: "cocktail", name: "House cocktail", priceCents: 1500 })],
    EVERY_DAY,
  );
  assert.equal(noTier.warnings.length, 0);
  check("no price-tier known → high-price ceiling does not fire");

  // A $14 FOOD item at a casual venue is not a drink → no drink-ceiling warn.
  const food = sanitizeOfferings(
    [off({ kind: "drink", name: "$14 Wing Central", priceCents: 1400 })], // re-kinds to food
    EVERY_DAY,
    { priceLevel: 1 },
  );
  assert.ok(!food.warnings.some((w) => /high/i.test(w)), `food item must not get a drink high-price warning, got: ${food.warnings.join(" / ")}`);
  check("a $14 food item (re-kinded) gets no drink high-price warning");
}

// ── Grand Lake Kitchen golden: price duplicated into name + heading-as-offering ──────
// The lake-merritt-menus extraction stored names like "$19 Kamala Llama hummus" WITH
// price_cents=1900 (price duplicated), and captured the section heading "HAPPY HOUR AT
// GLK" as an $18 offering. Both inflated the avg over $12 and double-printed the price.
{
  const r = sanitizeOfferings(
    [
      off({ kind: "food", name: "$19 Kamala Llama hummus", priceCents: 1900 }),
      off({ kind: "food", name: "$16 Pastrami Reuben beef pastrami", priceCents: 1600 }),
      off({ kind: "food", name: "$18 HAPPY HOUR AT GLK", priceCents: 1800 }),
      off({ kind: "drink", name: "$5 ON IT HH LAGER", priceCents: 500 }),
    ],
    [1, 2, 3, 4, 5],
  );

  const hummus = r.offerings.find((o) => o.name?.includes("Kamala"));
  assert.equal(hummus?.name, "Kamala Llama hummus");
  check("GLK: redundant '$19 ' price prefix stripped from stored name (price_cents kept)");
  assert.equal(hummus?.priceCents, 1900);
  check("GLK: stripping the name prefix leaves price_cents untouched");

  const lager = r.offerings.find((o) => o.name?.includes("LAGER"));
  assert.equal(lager?.name, "ON IT HH LAGER");
  check("GLK: '$5 ' stripped from a real drink deal too");

  assert.ok(
    !r.offerings.some((o) => /happy hour at glk/i.test(o.name ?? "")),
    `expected the "HAPPY HOUR AT GLK" heading dropped, got: ${r.offerings.map((o) => o.name).join(" / ")}`,
  );
  check("GLK: section-heading pseudo-offering 'HAPPY HOUR AT GLK' dropped");
  assert.ok(
    r.warnings.some((w) => /heading/i.test(w)),
    `expected a heading-drop warning, got: ${r.warnings.join(" / ")}`,
  );
  check("GLK: heading drop is recorded as a warning");
}

// ── Guard: never strip a discount phrase or a real "happy hour <item>" deal ───────────
{
  // "$1 Off All Drinks" is a discount, not an absolute price → leave the name intact.
  const discount = sanitizeOfferings([off({ kind: "drink", name: "$1 Off All Drinks", priceCents: null })], EVERY_DAY);
  assert.equal(discount.offerings[0]?.name, "$1 Off All Drinks");
  check("guard: '$N Off …' discount prefix is NOT stripped");

  // A leading "$5 Off" stays even when a price is set (lookahead protects the word "off").
  const offWithPrice = sanitizeOfferings([off({ kind: "food", name: "$5 Off Wings", priceCents: 500 })], EVERY_DAY);
  assert.equal(offWithPrice.offerings[0]?.name, "$5 Off Wings");
  check("guard: '$5 Off Wings' keeps its 'Off' even with a price set");

  // A genuine deal that merely mentions happy hour AND names a drink survives.
  const realDeal = sanitizeOfferings([off({ kind: "drink", name: "$5 Happy Hour Lager", priceCents: 500 })], EVERY_DAY);
  assert.equal(realDeal.offerings.length, 1);
  assert.equal(realDeal.offerings[0]?.name, "Happy Hour Lager");
  check("guard: '$5 Happy Hour Lager' (real drink) kept, only the price prefix stripped");
}

// ── classifyStoredOffering: the backfill's per-row verdict over ALREADY-STORED rows ──
{
  assert.deepEqual(classifyStoredOffering({ name: "$19 Kamala Llama hummus", priceCents: 1900 }), {
    action: "rename",
    newName: "Kamala Llama hummus",
  });
  check("classify: price-prefixed name → rename to the stripped name");

  assert.deepEqual(classifyStoredOffering({ name: "$18 HAPPY HOUR AT GLK", priceCents: 1800 }), {
    action: "drop",
  });
  check("classify: '$18 HAPPY HOUR AT GLK' → drop (heading, after strip)");

  assert.deepEqual(classifyStoredOffering({ name: "HAPPY HOUR AT GLK", priceCents: null }), { action: "drop" });
  check("classify: bare heading with no price → drop");

  // A generically-named but PRICED row is a real deal, not a heading — keep it.
  // (The White Chocolate Grill: "Happy Hour Drinks" at $9.50.)
  assert.deepEqual(classifyStoredOffering({ name: "Happy Hour Drinks", priceCents: 950 }), { action: "keep" });
  check("classify: priced 'Happy Hour Drinks' ($9.50) → keep (real deal, not a heading)");

  assert.deepEqual(classifyStoredOffering({ name: "Happy Hour Specials", priceCents: null }), { action: "drop" });
  check("classify: 'Happy Hour Specials' with no price → drop (contentless heading)");

  assert.deepEqual(classifyStoredOffering({ name: "$1 off draft beers", priceCents: null }), { action: "keep" });
  check("classify: '$N off …' discount → keep (not a redundant price)");

  assert.deepEqual(classifyStoredOffering({ name: "Wells", priceCents: 500 }), { action: "keep" });
  check("classify: already-clean name → keep (idempotent)");

  assert.deepEqual(classifyStoredOffering({ name: "$5 Happy Hour Lager", priceCents: 500 }), {
    action: "rename",
    newName: "Happy Hour Lager",
  });
  check("classify: real 'Happy Hour <item>' deal → rename, never dropped");
}

console.log(`\n✓ ${passed} offering-sanity + denylist assertions passed.`);
