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
check("BentoBox getbento CDN menu image is exempt (Limón bug — not suspect)", () =>
  assert.equal(
    isSourceProvenanceSuspect("https://images.getbento.com/accounts/x/media/images/happy_hour.png", "https://www.limonrestaurants.com/"),
    false,
  ));
check("Toast ordering/menu host is exempt (not suspect)", () =>
  assert.equal(isSourceProvenanceSuspect("https://foo.toasttab.com/menu", "https://foo.com"), false));
check("Wix file host (wixstatic) is exempt (not suspect)", () =>
  assert.equal(
    isSourceProvenanceSuspect("https://static.wixstatic.com/ugd/abc_def.pdf", "https://foo.com"),
    false,
  ));

// aggregator / third-party listing sources are suspect — even with no venue website to
// compare (Eddie V's Yelp-sourced HH; never the venue's own first-party schedule)
check("Yelp source IS suspect (aggregator, host ≠ venue)", () =>
  assert.equal(isSourceProvenanceSuspect("https://www.yelp.com/biz/eddie-vs-scottsdale", "https://www.eddiev.com/"), true));
check("Yelp source IS suspect even when the venue has NO stored website", () =>
  assert.equal(isSourceProvenanceSuspect("https://www.yelp.com/biz/x", null), true));
check("OpenTable / DoorDash sources ARE suspect (third-party listing/ordering)", () => {
  assert.equal(isSourceProvenanceSuspect("https://www.opentable.com/r/foo", "https://foo.com"), true);
  assert.equal(isSourceProvenanceSuspect("https://www.doordash.com/store/foo", null), true);
});
check("a venue's OWN toasttab is still exempt (aggregator list ≠ menu host)", () =>
  assert.equal(isSourceProvenanceSuspect("https://foo.toasttab.com/menu", "https://foo.com"), false));

// can't judge → no opinion (never hide on insufficient signal)
check("no stored venue website → not suspect (can't judge)", () =>
  assert.equal(isSourceProvenanceSuspect("https://anything.com/x", null), false));
check("no/empty source url → not suspect", () =>
  assert.equal(isSourceProvenanceSuspect("", "https://foo.com"), false));
check("unparseable source url → not suspect (can't judge)", () =>
  assert.equal(isSourceProvenanceSuspect("not a url", "https://foo.com"), false));

// ── allowlist + same-registrable-domain tuning (goldens from the 2026-06-13 audit) ──
// File/CDN/website-builder hosts that legitimately serve a venue's OWN menu assets —
// false positives in the first audit; allowlisted so the guard stops flagging them.
check("GoDaddy asset CDN (img1.wsimg.com) is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://img1.wsimg.com/blobby/go/x/downloads/menu.pdf", "https://cantondragonscottsdale.com"), false));
check("Duda CDN (irp.cdn-website.com) is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://irp.cdn-website.com/abc/menu.pdf", "https://tacosbyparachos.com"), false));
check("Shopify asset CDN is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://cdn.shopify.com/s/files/menu.pdf", "https://badjimmys.com"), false));
check("Popmenu CDN (popmenucloud.com) is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://popmenucloud.com/abc/menu.png", "https://carlosobriens.com"), false));
check("Webflow asset CDN (website-files.com) is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://cdn.prod.website-files.com/abc/menu.pdf", "https://andazscottsdale.com"), false));
check("WordPress/Jetpack image CDN (wp.com) is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://i0.wp.com/branchline.bar/menu.jpg", "https://branchline.bar"), false));
check("digital-menu platform (sagemenu.com) is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://sagemenu.com/m/chula", "https://chulaseafood.com"), false));
check("QR-menu file host (qr-code-generator.com) is exempt", () =>
  assert.equal(isSourceProvenanceSuspect("https://cdn.qr-code-generator.com/abc/menu.pdf", "https://woolyspismobeach.com"), false));

// Sibling subdomains of the SAME registrable domain are the same business (Dog Haus:
// venue stored as downtownphoenix.doghaus.com, source locations.doghaus.com).
check("GOLDEN Dog Haus: sibling subdomains of doghaus.com are not suspect", () =>
  assert.equal(
    isSourceProvenanceSuspect("https://locations.doghaus.com/downtown-phoenix", "https://downtownphoenix.doghaus.com"),
    false,
  ));

// Genuine bad sources from the audit STAY flagged → hide.
check("GOLDEN Blanco (Scottsdale): sibling-brand domain stays suspect", () =>
  assert.equal(isSourceProvenanceSuspect("https://www.blancococinacantina.com/?menu=happy-hour-menu", "https://blancotacostequila.com"), true));
check("social media (instagram.com) is not a first-party source → suspect", () =>
  assert.equal(isSourceProvenanceSuspect("https://www.instagram.com/p/abc", "https://basepizzeria.com"), true));
check("third-party directory (whereis.gay) → suspect", () =>
  assert.equal(isSourceProvenanceSuspect("https://whereis.gay/venue/nu-towne", "https://nutownephoenix.com"), true));
check("local blog (thescottsdaleliving.com) → suspect", () =>
  assert.equal(isSourceProvenanceSuspect("https://thescottsdaleliving.com/chula", "https://chulaseafood.com"), true));

console.log(`\n${passed} checks passed.`);
