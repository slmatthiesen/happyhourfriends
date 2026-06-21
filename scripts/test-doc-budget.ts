/**
 * Unit checks for selectDocsWithinBudget — the count+byte budget that picks which menu
 * PDFs/images reach the model. No DB/AI/network ($0). Run: pnpm tsx scripts/test-doc-budget.ts
 */
import assert from "node:assert/strict";
import { selectDocsWithinBudget } from "@/lib/ai/siteContent";
import type { FetchResult } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// base64 length L → raw bytes = L * 0.75 (the helper's accounting). Build a PDF doc of a
// given raw size so the budget arithmetic is exercised with tiny strings.
function pdf(url: string, rawBytes: number): FetchResult {
  return { url, ok: true, isPdf: true, pdfBase64: "x".repeat(Math.round(rawBytes / 0.75)) };
}

// Hula Hoops shape: two filename-score-0 menus, the HH (dinner) ranked FIRST by the caller
// (extractMediaLinks HH-context order). The budget fits only one → it must be the HH dinner.
check("budget spends on the HH-first doc and drops the trailing menu (Hula dinner vs brunch)", () => {
  const docs = [
    pdf("https://x.com/uploads/Dinner-Menu.pdf", 6_900_000),
    pdf("https://x.com/uploads/Brunch-Menu.pdf", 7_900_000),
  ];
  const picked = selectDocsWithinBudget(docs, { maxBytes: 10_000_000, maxPages: 5 });
  assert.deepEqual(picked.map((p) => p.url), ["https://x.com/uploads/Dinner-Menu.pdf"]);
});

// Relevance beats caller order AND size: an explicit happy-hour doc (scoreHhUrl 100) ranks
// ahead of a generic food menu (40) even when the food menu came first and is smaller (Bei
// Sushi). Both fit, so the assertion is about ORDER, not the budget.
check("higher scoreHhUrl outranks caller order and size", () => {
  const docs = [
    pdf("https://x.com/food-menu.pdf", 1_000_000),
    pdf("https://x.com/happy-hour.pdf", 2_000_000),
  ];
  const picked = selectDocsWithinBudget(docs, { maxBytes: 10_000_000, maxPages: 5 });
  assert.deepEqual(picked.map((p) => p.url), [
    "https://x.com/happy-hour.pdf",
    "https://x.com/food-menu.pdf",
  ]);
});

check("equal score keeps caller order (stable) when both fit", () => {
  const docs = [pdf("https://x.com/a-menu.pdf", 1_000_000), pdf("https://x.com/b-menu.pdf", 1_000_000)];
  const picked = selectDocsWithinBudget(docs, { maxBytes: 10_000_000, maxPages: 5 });
  assert.deepEqual(picked.map((p) => p.url), ["https://x.com/a-menu.pdf", "https://x.com/b-menu.pdf"]);
});

check("maxPages caps the number of docs even when bytes fit", () => {
  const docs = [1, 2, 3].map((n) => pdf(`https://x.com/menu-${n}.pdf`, 500_000));
  const picked = selectDocsWithinBudget(docs, { maxBytes: 10_000_000, maxPages: 2 });
  assert.equal(picked.length, 2);
});

check("staleDated docs are skipped (fresh page text supersedes them)", () => {
  const docs = [pdf("https://x.com/2021-menu.pdf", 1_000_000), pdf("https://x.com/current-menu.pdf", 1_000_000)];
  const picked = selectDocsWithinBudget(docs, {
    maxBytes: 10_000_000,
    maxPages: 5,
    staleDated: (u) => u.includes("2021"),
  });
  assert.deepEqual(picked.map((p) => p.url), ["https://x.com/current-menu.pdf"]);
});

check("an oversized single doc that exceeds the budget is dropped", () => {
  const docs = [pdf("https://x.com/huge-menu.pdf", 19_000_000)];
  assert.deepEqual(selectDocsWithinBudget(docs, { maxBytes: 10_000_000, maxPages: 5 }), []);
});

console.log(`\n✓ ${passed} doc-budget checks passed.`);
