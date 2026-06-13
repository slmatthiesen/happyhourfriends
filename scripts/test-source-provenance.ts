/**
 * Runnable unit checks for source/provenance integrity (no test framework in repo).
 * Run: npx tsx scripts/test-source-provenance.ts — exits non-zero on any failure.
 *
 * Goldens drawn from the 2026-06-13 extraction-miss diagnosis (bucket #1, the D
 * wrong-capture cases): a stored happy-hour window whose source_url is not the
 * venue's own site silently poisons a good venue. These lock the two deterministic
 * guards that catch it:
 *   - isDenylistedSource: third-party HH aggregators (cheerhop & siblings).
 *   - isSourceProvenanceSuspect: source host ≠ venue host (and not a menu host).
 */
import assert from "node:assert/strict";
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";
import { isSourceProvenanceSuspect } from "@/lib/recover/sourceProvenance";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── part (a): aggregator denylist (Wooden City golden) ───────────────────────
check("GOLDEN Wooden City: cheerhop.com aggregator source is denylisted", () =>
  assert.equal(isDenylistedSource("https://cheerhop.com/tacoma/wooden-city-tacoma"), true));
check("a venue's own site is not denylisted", () =>
  assert.equal(isDenylistedSource("http://woodencitytacoma.com/"), false));

// ── part (b): source-host == venue-host at persist ───────────────────────────
check("GOLDEN Depot Bar: source thedepotbar.com ≠ venue thedepotbar.shop → suspect", () =>
  assert.equal(
    isSourceProvenanceSuspect("https://thedepotbar.com/", "https://thedepotbar.shop/"),
    true,
  ));
check("GOLDEN Blanco: source sibling-brand domain ≠ venue domain → suspect", () =>
  assert.equal(
    isSourceProvenanceSuspect(
      "https://www.blancococinacantina.com/locations/paradise-valley/?menu=happy-hour-menu",
      "http://blancotacostequila.com/",
    ),
    true,
  ));
check("GOLDEN Wooden City: cheerhop source ≠ venue host → suspect (belt-and-suspenders)", () =>
  assert.equal(
    isSourceProvenanceSuspect("https://cheerhop.com/tacoma/wooden-city-tacoma", "http://woodencitytacoma.com/"),
    true,
  ));

// same site → trusted, never hidden
check("source on the venue's own site is not suspect", () =>
  assert.equal(isSourceProvenanceSuspect("https://foo.com/happy-hour", "https://foo.com"), false));
check("www vs bare host is not suspect", () =>
  assert.equal(isSourceProvenanceSuspect("https://www.foo.com/menu", "https://foo.com"), false));
check("subdomain of the venue site is not suspect", () =>
  assert.equal(isSourceProvenanceSuspect("https://menu.foo.com/hh", "https://foo.com"), false));

// known menu/file hosts can't be host-matched → no opinion (don't hide real data)
check("Squarespace CDN menu PDF is exempt (not suspect)", () =>
  assert.equal(
    isSourceProvenanceSuspect("https://static1.squarespace.com/static/abc/menu.pdf", "https://foo.com"),
    false,
  ));
check("Toast ordering/menu host is exempt (not suspect)", () =>
  assert.equal(isSourceProvenanceSuspect("https://foo.toasttab.com/menu", "https://foo.com"), false));
check("Wix file host (wixstatic) is exempt (not suspect)", () =>
  assert.equal(
    isSourceProvenanceSuspect("https://static.wixstatic.com/ugd/abc_def.pdf", "https://foo.com"),
    false,
  ));

// can't judge → no opinion (never hide on insufficient signal)
check("no stored venue website → not suspect (can't judge)", () =>
  assert.equal(isSourceProvenanceSuspect("https://anything.com/x", null), false));
check("no/empty source url → not suspect", () =>
  assert.equal(isSourceProvenanceSuspect("", "https://foo.com"), false));
check("unparseable source url → not suspect (can't judge)", () =>
  assert.equal(isSourceProvenanceSuspect("not a url", "https://foo.com"), false));

console.log(`\n${passed} checks passed.`);
