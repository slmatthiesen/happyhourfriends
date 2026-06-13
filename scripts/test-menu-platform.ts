/**
 * Runnable unit checks for menu-platform website detection (no test framework in repo).
 * Run: npx tsx scripts/test-menu-platform.ts — exits non-zero on any failure.
 *
 * A "menu platform" website is a venue whose ONLY web presence is a third-party
 * menu/listing page (kwickmenu, menu11, wheree) rather than its own site. Operator
 * 2026-06-13: these are not real first-party venues worth featuring — soft-delete the
 * stub (drop:menu-platform-stubs). Goldens from real Daly City / Scottsdale data.
 */
import assert from "node:assert/strict";
import { isMenuPlatformWebsite } from "@/lib/places/menuPlatform";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("GOLDEN kwickmenu subdomain (goldendragon.kwickmenu.com)", () =>
  assert.equal(isMenuPlatformWebsite("https://goldendragon.kwickmenu.com/"), true));
check("GOLDEN menu11 subdomain (shioramen.menu11.com)", () =>
  assert.equal(isMenuPlatformWebsite("http://shioramen.menu11.com/"), true));
check("GOLDEN wheree subdomain (shio-ramen-crudo.wheree.com)", () =>
  assert.equal(isMenuPlatformWebsite("https://shio-ramen-crudo.wheree.com/"), true));
check("apex menu-platform domain matches too", () =>
  assert.equal(isMenuPlatformWebsite("https://kwickmenu.com/x"), true));
check("case-insensitive + www", () =>
  assert.equal(isMenuPlatformWebsite("https://www.KwickMenu.com/"), true));

check("a real first-party venue site is NOT a menu platform", () =>
  assert.equal(isMenuPlatformWebsite("https://goldendragon.com/"), false));
check("a lookalike substring does not false-match (kwickmenuhouse.com)", () =>
  assert.equal(isMenuPlatformWebsite("https://kwickmenuhouse.com/"), false));
check("null / empty → false", () => {
  assert.equal(isMenuPlatformWebsite(null), false);
  assert.equal(isMenuPlatformWebsite(""), false);
});
check("unparseable → false", () =>
  assert.equal(isMenuPlatformWebsite("not a url"), false));

console.log(`\n${passed} checks passed.`);
