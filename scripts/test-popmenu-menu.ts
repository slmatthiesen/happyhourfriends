/**
 * Runnable unit checks for Popmenu menu-route discovery (no test framework in repo).
 * Run: npx tsx scripts/test-popmenu-menu.ts — exits non-zero on any failure.
 *
 * Popmenu venues serve the actual happy-hour items (names + prices) on a first-party SPA
 * route — /menus/web-happy-hour?location=<slug> — injected by Popmenu's JS, so it never
 * appears in the static landing HTML and is not a cross-origin <iframe> (extractMenuEmbedUrls
 * misses it). The landing page renders ALL menu routes as anchors; we follow ONLY the happy-
 * hour one(s) to avoid flooding the payload with regular-menu items. Goldens from the real
 * Reunion Kitchen + Drink (Santa Barbara) rendered page — 2026-06-29.
 */
import assert from "node:assert/strict";
import { isPopmenuContent, extractPopmenuHappyHourRoutes } from "@/lib/places/popmenu";

// Trimmed, faithful slice of the Jina-rendered Reunion Kitchen Santa Barbara landing page.
const REUNION_RENDERED = `
![logo](https://popmenucloud.com/cdn-cgi/image/width=1200/pevmqrta/13a896a0.jpg)
### Happy Hour
Monday - Friday: 2:30pm –6pm
[Food](https://www.reunionkitchen.net/menus/web-food?location=santa-barbara)Snack Plates Entrées
[Drinks](https://www.reunionkitchen.net/menus/web-drinks?location=santa-barbara)
[WINE](https://www.reunionkitchen.net/menus/web-wine?location=santa-barbara)
[KIDS](https://www.reunionkitchen.net/menus/web-kids?location=santa-barbara)
[Happy Hour](https://www.reunionkitchen.net/menus/web-happy-hour?location=santa-barbara)
[Made with by Popmenu(opens in a new window)](https://get.popmenu.com/)
`;

const BASE = "https://www.reunionkitchen.net/santa-barbara";

const PLAIN_SITE = `
<html><head><title>Joe's Bar</title></head>
<body><h1>Happy Hour 3-6pm</h1><a href="/menu.pdf">Menu</a></body></html>
`;

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- detection ---------------------------------------------------------------------------
check("GOLDEN detects Popmenu via popmenucloud.com / get.popmenu.com signature", () =>
  assert.equal(isPopmenuContent(REUNION_RENDERED), true));
check("a plain non-Popmenu site is NOT detected", () =>
  assert.equal(isPopmenuContent(PLAIN_SITE), false));
check("empty / undefined → false", () => {
  assert.equal(isPopmenuContent(""), false);
  assert.equal(isPopmenuContent(undefined as unknown as string), false);
});

// --- happy-hour route harvest ------------------------------------------------------------
check("GOLDEN returns the web-happy-hour route, absolute", () => {
  const routes = extractPopmenuHappyHourRoutes(REUNION_RENDERED, BASE);
  assert.deepEqual(routes, [
    "https://www.reunionkitchen.net/menus/web-happy-hour?location=santa-barbara",
  ]);
});
check("EXCLUDES regular menu routes (food/drinks/wine/kids) — no over-capture", () => {
  const routes = extractPopmenuHappyHourRoutes(REUNION_RENDERED, BASE);
  for (const slug of ["web-food", "web-drinks", "web-wine", "web-kids"]) {
    assert.equal(routes.some((u) => u.includes(slug)), false, `should not include ${slug}`);
  }
});
check("absolutizes a relative menu route against the base URL", () => {
  const md = `[Happy Hour](/menus/web-happy-hour?location=brea)`;
  assert.deepEqual(extractPopmenuHappyHourRoutes(md, "https://www.reunionkitchen.net/brea"), [
    "https://www.reunionkitchen.net/menus/web-happy-hour?location=brea",
  ]);
});
check("EXCLUDES a foreign-host menu route (only the venue's own domain)", () => {
  const md = `[HH](https://evil.example.com/menus/web-happy-hour?location=x)`;
  assert.deepEqual(extractPopmenuHappyHourRoutes(md, BASE), []);
});
check("dedupes repeated routes", () => {
  const md = REUNION_RENDERED + REUNION_RENDERED;
  assert.equal(extractPopmenuHappyHourRoutes(md, BASE).length, 1);
});
check("no happy-hour route present → empty", () => {
  const md = `[Food](https://www.reunionkitchen.net/menus/web-food?location=x)`;
  assert.deepEqual(extractPopmenuHappyHourRoutes(md, BASE), []);
});

console.log(`\n${passed} checks passed.`);
