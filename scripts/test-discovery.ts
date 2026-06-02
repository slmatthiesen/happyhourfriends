/**
 * Runnable check: multi-source page discovery (Tier 1) — read declared routes, guess
 * common menu paths, and rank confirmed pages ahead of guesses so a high-scoring guess
 * (/happy-hour) can't crowd out a real route (/menu). No network.
 *
 * Run: tsx scripts/test-discovery.ts
 */
import assert from "node:assert";
import { extractPageRoutes, guessMenuUrls, rankCandidates, GUESS_MENU_PATHS, extractMediaLinks } from "@/lib/places/siteTriage";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("extractPageRoutes pulls pageUriSEO routes, skips home, builds absolute URLs", () => {
  const html = `x"pageUriSEO":"menu"y"pageUriSEO":"menus"z"pageUriSEO":"home"q"pageUriSEO":"about-6"`;
  const routes = extractPageRoutes(html, "https://x.com/");
  assert.ok(routes.includes("https://x.com/menu"), "has /menu");
  assert.ok(routes.includes("https://x.com/menus"), "has /menus");
  assert.ok(routes.includes("https://x.com/about-6"), "has /about-6");
  assert.ok(!routes.some((u) => u.endsWith("/home")), "skips home");
});

check("guessMenuUrls builds the guess list on the origin", () => {
  const g = guessMenuUrls("https://x.com/some/deep/path?q=1");
  assert.ok(g.includes("https://x.com/happy-hour"));
  assert.ok(g.includes("https://x.com/menu"));
  assert.equal(g.length, GUESS_MENU_PATHS.length);
});

check("rankCandidates dedupes + orders most-likely-HH first", () => {
  const r = rankCandidates([
    "https://x.com/about",
    "https://x.com/menu",
    "https://x.com/happy-hour",
    "https://x.com/menu", // dup
  ]);
  assert.equal(r.indexOf("https://x.com/happy-hour"), 0, "happy-hour first");
  assert.ok(r.indexOf("https://x.com/menu") < r.indexOf("https://x.com/about"), "menu before about");
  assert.equal(r.filter((u) => u.endsWith("/menu")).length, 1, "deduped");
});

check("confirmed-before-guesses keeps /menu when guesses outscore it (the Bottega bug)", () => {
  // Real routes from the site model:
  const confirmed = rankCandidates(["https://x.com/menu", "https://x.com/menus"], 8);
  // Speculative guesses (some score higher, e.g. /happy-hour=100 vs /menu=30):
  const guesses = rankCandidates(guessMenuUrls("https://x.com/"), 12);
  const final = [...new Set([...confirmed, ...guesses])].slice(0, 10);
  assert.ok(final.includes("https://x.com/menu"), "/menu (real route) survives ranking");
  assert.ok(final.indexOf("https://x.com/menu") < 8, "/menu is in the fetched window");
});

check("extractMediaLinks: PDFs (any) + menu-signal images, skips decorative photos", () => {
  const html = `
    <a href="/files/dinner-menu.pdf">Dinner</a>
    <a href="/happy-hour.pdf">HH</a>
    <a href="/images/happy-hour-menu.jpg">bar menu</a>
    <img src="/img/menu-board.png" alt="our menu">
    <img src="/img/patio-sunset.jpg" alt="the patio at dusk">
  `;
  const media = extractMediaLinks(html, "https://x.com/");
  assert.ok(media.includes("https://x.com/files/dinner-menu.pdf"), "pdf kept");
  assert.ok(media.includes("https://x.com/happy-hour.pdf"), "hh pdf kept");
  assert.ok(media.includes("https://x.com/images/happy-hour-menu.jpg"), "menu image link kept");
  assert.ok(media.includes("https://x.com/img/menu-board.png"), "menu <img> kept");
  assert.ok(!media.some((u) => u.includes("patio-sunset")), "decorative photo skipped");
});

console.log(`\n${passed} checks passed.`);
