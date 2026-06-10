/**
 * Golden tests for lib/recover/offeringSanity — cases lifted verbatim from the
 * 2026-06-10 operator flag review (Bistro 44 + Backyard Public House garbling)
 * plus guards against over-correction. Pure logic, no DB — runs in CI.
 * Also covers the sourceDenylist additions from the same review.
 */
import assert from "node:assert/strict";
import { sanitizeOfferings } from "@/lib/recover/offeringSanity";
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
  const kinds = Object.fromEntries(r.offerings.map((o) => [o.name, o.kind]));
  assert.equal(kinds["$10 All Shareables Happy Hour"], "food");
  assert.equal(kinds["$10 Backyard Burger Tuesday Happy"], "food");
  assert.equal(kinds["$12 Riverside Tacos"], "food");
  assert.equal(kinds["$14 Wing Central"], "food");
  check("Backyard: shareables/burger/tacos/wings all re-kinded drink→food");
  assert.equal(kinds["$1 off draft beers"], "drink");
  assert.equal(kinds["$5 Wells"], "drink");
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

console.log(`\n✓ ${passed} offering-sanity + denylist assertions passed.`);
