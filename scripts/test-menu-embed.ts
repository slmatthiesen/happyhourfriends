/**
 * Unit checks for extractMenuEmbedUrls — finds third-party MENU-widget iframes (SinglePlatform
 * et al.) whose content holds the HH deals, so the extractor can fetch them as text. No
 * DB/AI/network ($0). Run: pnpm tsx scripts/test-menu-embed.ts
 *
 * Why: Finch & Fork (Santa Barbara, Milestone CMS / Kimpton) serves its happy-hour menu in a
 * cross-origin SinglePlatform iframe — invisible to the page's own text and to extractMediaLinks
 * (which only scans <a>/<img>/ld+json media). The window extracted, the deals didn't → a bare
 * window. These hosts are platform-wide, so catching the iframe recovers a whole class of venues.
 */
import assert from "node:assert/strict";
import { extractMenuEmbedUrls } from "@/lib/places/siteTriage";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const SP = "https://places.singleplatform.com/finch--fork/menu_widget?api_key=ke09z8icq4xu8uiiccighy1bw&display_menu=5957675";

check("captures a SinglePlatform menu_widget iframe", () => {
  const html = `<div><iframe src="${SP}" frameborder="0"></iframe></div>`;
  assert.deepEqual(extractMenuEmbedUrls(html, "https://www.finchandforkrestaurant.com/menus/happy-hour"), [SP]);
});

check("absolutizes a protocol-relative menu-widget iframe", () => {
  const html = `<iframe src="//places.singleplatform.com/x/menu_widget?display_menu=1"></iframe>`;
  assert.deepEqual(
    extractMenuEmbedUrls(html, "https://v.com/menus"),
    ["https://places.singleplatform.com/x/menu_widget?display_menu=1"],
  );
});

check("ignores non-menu iframes (maps, social, video, reservations)", () => {
  const html = [
    `<iframe src="https://www.google.com/maps/embed?pb=abc"></iframe>`,
    `<iframe src="https://www.instagram.com/p/abc/embed"></iframe>`,
    `<iframe src="https://www.youtube.com/embed/abc"></iframe>`,
    `<iframe src="https://www.opentable.com/widget/reservation/canvas?rid=123"></iframe>`,
  ].join("");
  assert.deepEqual(extractMenuEmbedUrls(html, "https://v.com/"), []);
});

check("no iframes → empty", () =>
  assert.deepEqual(extractMenuEmbedUrls("<p>Happy Hour 4-5pm</p>", "https://v.com/"), []));

check("dedupes the same widget appearing twice (modal + inline)", () => {
  const html = `<iframe src="${SP}"></iframe><iframe src="${SP}"></iframe>`;
  assert.deepEqual(extractMenuEmbedUrls(html, "https://v.com/"), [SP]);
});

check("drops the _modal all-menus browser when a scoped widget is present (HH page has both)", () => {
  // SinglePlatform HH pages embed the HH-scoped widget AND a modal that browses EVERY menu;
  // the modal floods the payload with regular-menu items → meal-special over-capture. Keep only
  // the scoped widget so the model sees just the happy-hour deals.
  const modal = "https://places.singleplatform.com/finch--fork/menu_widget_modal";
  const scoped = "https://places.singleplatform.com/finch--fork/menu_widget?display_menu=5957675";
  const html = `<iframe src="${modal}"></iframe><iframe src="${scoped}"></iframe>`;
  assert.deepEqual(extractMenuEmbedUrls(html, "https://v.com/menus/happy-hour"), [scoped]);
});

check("keeps a lone _modal widget when no scoped sibling exists (don't lose the only menu)", () => {
  const modal = "https://places.singleplatform.com/x/menu_widget_modal";
  assert.deepEqual(extractMenuEmbedUrls(`<iframe src="${modal}"></iframe>`, "https://v.com/"), [modal]);
});

check("decodes &amp; entities in the iframe src (else display_menu becomes 'amp;display_menu')", () => {
  // Rendered HTML serializes the src with &amp; — left encoded, the menu-scoping query param is
  // mis-named and the widget returns EVERY menu (260KB) instead of the happy-hour one.
  const html = `<iframe src="https://places.singleplatform.com/x/menu_widget?api_key=k&amp;display_menu=5957675"></iframe>`;
  assert.deepEqual(
    extractMenuEmbedUrls(html, "https://v.com/"),
    ["https://places.singleplatform.com/x/menu_widget?api_key=k&display_menu=5957675"],
  );
});

check("captures a Toast online-ordering menu iframe (known menu host)", () => {
  const u = "https://order.toasttab.com/online/some-bar";
  const html = `<iframe src="${u}"></iframe>`;
  assert.deepEqual(extractMenuEmbedUrls(html, "https://v.com/"), [u]);
});

console.log(`\n✓ ${passed} menu-embed checks passed.`);
