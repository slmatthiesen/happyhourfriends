/**
 * test-fetch-targets — hermetic checks for the fetch-target dedup that stops same-page
 * anchor links from burning the fetch budget (Bei Sushi: 4 #anchors crowded its
 * happy-hour PNG out, so the model never saw the deals). Also pins that media docs order
 * by happy-hour relevance so the HH image outranks a generic food menu under the budget.
 * Run: tsx scripts/test-fetch-targets.ts
 */
import assert from "node:assert/strict";
import { stripPageAnchor, fetchUrlKey, dedupeFetchTargets } from "@/lib/ai/siteContent";
import { scoreHhUrl } from "@/lib/places/hhText";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("stripPageAnchor drops plain #anchors but keeps hash-routes (#!/… and #/…)", () => {
  assert.equal(stripPageAnchor("https://x.com/#happyhour"), "https://x.com/");
  assert.equal(stripPageAnchor("https://x.com/menu#section"), "https://x.com/menu");
  assert.equal(stripPageAnchor("https://x.com/#!/menu"), "https://x.com/#!/menu"); // hashbang SPA route
  assert.equal(stripPageAnchor("https://x.com/#/menu"), "https://x.com/#/menu"); // hash route
  assert.equal(stripPageAnchor("https://x.com/menu"), "https://x.com/menu");
});

check("4 same-page anchors collapse to ONE fetch target", () => {
  const out = dedupeFetchTargets([
    "https://www.beisushi.com/#happyhour",
    "https://www.beisushi.com/#exploremenu",
    "https://www.beisushi.com/#kids",
    "https://www.beisushi.com/#lunchhour",
  ], 8);
  assert.deepEqual(out, ["https://www.beisushi.com/"]);
});

check("Bei Sushi: with anchors collapsed, the happy-hour PNG survives the cap", () => {
  const png = "https://images.squarespace-cdn.com/.../happy+hour_2.PNG";
  const out = dedupeFetchTargets([
    "http://beisushi.com/",
    "https://www.beisushi.com/#happyhour",
    "https://www.beisushi.com/#exploremenu",
    "https://www.beisushi.com/#kids",
    "https://www.beisushi.com/#lunchhour",
    "https://images.squarespace-cdn.com/.../bei+menu_print-01.jpg",
    "https://images.squarespace-cdn.com/.../bei+menu_print-02.jpg",
    png,
  ], 7);
  assert.ok(out.includes(png), "happy-hour PNG must be within the fetch cap");
  // The 4 anchors became 1, so the list is well under the cap.
  assert.ok(out.length <= 6, `expected anchors collapsed, got ${out.length}`);
});

check("trailing-slash variants dedup", () => {
  const out = dedupeFetchTargets(["https://x.com/menu", "https://x.com/menu/"], 5);
  assert.equal(out.length, 1);
});

check("max is respected; order preserved; null/empty filtered", () => {
  const out = dedupeFetchTargets(["https://a.com", null, "  ", "https://b.com", "https://c.com"], 2);
  assert.deepEqual(out, ["https://a.com", "https://b.com"]);
});

check("fetchUrlKey collapses anchor + slash to one key", () => {
  assert.equal(fetchUrlKey("https://x.com/#happyhour"), fetchUrlKey("https://x.com/"));
  assert.equal(fetchUrlKey("https://x.com/menu/"), fetchUrlKey("https://x.com/menu"));
});

check("media docs order: a happy-hour image outranks a generic food menu image", () => {
  // The sort key the budget loop uses — HH-named media must come first.
  const hh = scoreHhUrl("https://cdn/.../happy+hour_2.PNG");
  const food = scoreHhUrl("https://cdn/.../bei+menu_print-01.jpg");
  assert.ok(hh > food, `happy-hour image (${hh}) must outrank food menu (${food})`);
});

console.log(`\n${passed} checks passed.`);
