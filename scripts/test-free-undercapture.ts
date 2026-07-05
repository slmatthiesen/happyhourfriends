/**
 * freeUndercapturedOfferings — the escalation gap that lost Sevy's 8 food offerings.
 * The free parser scans ONLY the single time-range segment for offerings, so a block
 * menu (Wix OOI / Squarespace / Toast) whose items live in sibling segments under-captures:
 * the page lists many priced deals but the free parse returns one. The ZERO-offering gate
 * (freeLacksOfferings) then sees "not zero" and never escalates. This predicate fires on
 * that under-capture. Run: tsx scripts/test-free-undercapture.ts
 */
import assert from "node:assert";
import { countPriceTokens } from "@/lib/places/hhText";
import { freeUndercapturedOfferings } from "@/lib/ai/freeExtract";
import type { ExtractResult, ExtractedHappyHour } from "@/lib/ai/extractHappyHours";
import type { FetchedPage } from "@/lib/ai/siteContent";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

function win(opts: { days: number[]; start: string; end: string; offerings: string[] }): ExtractedHappyHour {
  return {
    daysOfWeek: opts.days,
    allDay: false,
    startTime: opts.start,
    endTime: opts.end,
    timeKnown: true,
    locationWithinVenue: "all",
    notes: null,
    sourceUrl: "https://x.com/hh",
    suspect: false,
    offerings: opts.offerings.map((name) => ({
      kind: "food", category: "appetizer", name, priceCents: 800, originalPriceCents: null,
      discountCents: null, discountPercent: null, description: null, conditions: null, sourceUrl: "https://x.com/hh",
    })),
  };
}
function freeOf(happyHours: ExtractedHappyHour[]): ExtractResult {
  return {
    happyHours, confidence: 1, summary: "test", venueType: null,
    usage: { inputTokens: 0, outputTokens: 0 }, costCents: 0, promptHash: "test", model: "deterministic-html-v1",
  };
}

// ── countPriceTokens ──
check("countPriceTokens: counts $8 / $ 9 / $5.50, ignores prices inside URLs", () => {
  assert.equal(countPriceTokens("$8 clam chowder and $ 9 sliders and $5.50 wings"), 3);
  assert.equal(countPriceTokens("see https://x.com/menu?id=$5off for $7 wine"), 1); // only the $7
  assert.equal(countPriceTokens("no prices here, just vibes"), 0);
});

// ── freeUndercapturedOfferings ──
const SEVYS_PAGE: FetchedPage = {
  url: "https://x.com/hh",
  // Mirrors Sevy's real shape: HH time + $1 off in the time segment, then a block of
  // priced food items in sibling segments the free parser cannot associate with the window.
  text: `Happy Hour Sunday - Thursday: 3-6pm $1 Off House wines and draught beers
Munchies
SMOKED SEAFOOD CHOWDER CUP $8
POTATO CHIPS & DIP $8
MEATLOAF SLIDERS $9
GARLIC PARMESAN FRIES $8
STREET TACOS (3) $10
JUMBO CHICKEN WINGS $14`,
};

check("UNDER-CAPTURE fires on Sevy's shape: 1 offering captured, 7 priced items on the page", () => {
  const free = freeOf([win({ days: [1, 2, 3, 4, 7], start: "15:00", end: "18:00", offerings: ["$1 off"] })]);
  assert.ok(freeUndercapturedOfferings(free, [SEVYS_PAGE]), "should escalate: page has more deals than free captured");
});

check("does NOT fire when free captured the only deal (bare $5 drafts page)", () => {
  const free = freeOf([win({ days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00", offerings: ["$5 drafts"] })]);
  const page: FetchedPage = { url: "https://x.com/hh", text: "Happy Hour Mon-Fri 3-6pm $5 drafts" };
  assert.ok(!freeUndercapturedOfferings(free, [page]));
});

check("does NOT fire when free captured every priced item on the page (clean capture)", () => {
  // Page lists exactly 2 priced HH items; free captured both → no under-capture.
  const free = freeOf([win({ days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00", offerings: ["$9 cocktails", "$7 wine"] })]);
  const page: FetchedPage = { url: "https://x.com/hh", text: "Happy Hour 2-5pm $9 cocktails $7 wine" };
  assert.ok(!freeUndercapturedOfferings(free, [page]));
});

check("does NOT fire when free is null (freeLacksOfferings owns the zero case)", () => {
  assert.ok(!freeUndercapturedOfferings(null, [SEVYS_PAGE]));
});

check("does NOT fire when free has zero offerings (owned by freeLacksOfferings)", () => {
  const free = freeOf([win({ days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00", offerings: [] })]);
  assert.ok(!freeUndercapturedOfferings(free, [SEVYS_PAGE]));
});

check("counts only the page that PRODUCED a window, not incidental pages", () => {
  // A homepage with a long dinner menu (many prices) must not, by itself, force an
  // escalate when the HH window came from a different, bare page.
  const free = freeOf([win({ days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00", offerings: ["$5 drafts"] })]);
  const hhPage: FetchedPage = { url: "https://x.com/hh", text: "Happy Hour Mon-Fri 3-6pm $5 drafts" };
  const homePage: FetchedPage = { url: "https://x.com/", text: "Dinner: steak $38, salmon $32, pasta $24, chicken $22" };
  assert.ok(!freeUndercapturedOfferings(free, [hhPage, homePage]));
});

console.log(`\n${passed} checks passed.`);
