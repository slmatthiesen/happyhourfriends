/**
 * Runnable unit checks for siteTriage pure helpers (no test framework in repo).
 * Run: npx tsx scripts/test-site-triage.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  classifyUrl,
  isParkedHtml,
  extractHhSignalLinks,
  extractMediaLinks,
  fullResImageUrl,
  resolveEnrichAction,
  siteVerdictFromFetch,
  classifyFetchError,
  type SiteVerdict,
} from "@/lib/places/siteTriage";

function fetchErr(code: string): Error {
  const e = new Error("fetch failed") as Error & { cause?: { code: string } };
  e.cause = { code };
  return e;
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// classifyUrl
check("empty → none", () => assert.equal(classifyUrl(null).kind, "none"));
check("facebook → social_only", () =>
  assert.equal(classifyUrl("https://www.facebook.com/obriens").kind, "social_only"));
check("linktree → social_only", () =>
  assert.equal(classifyUrl("https://linktr.ee/unostacosaz").kind, "social_only"));
check("doordash → social_only", () =>
  assert.equal(classifyUrl("https://www.doordash.com/store/x").kind, "social_only"));
check("real domain → real", () => {
  const c = classifyUrl("http://brixphoenix.com/");
  assert.equal(c.kind, "real");
  assert.equal(c.url, "http://brixphoenix.com/");
});

// isParkedHtml
check("for-sale page is parked", () =>
  assert.equal(isParkedHtml('<title>brix.com is for sale</title><body>Buy this domain</body>'), true));
check("real menu page is not parked", () =>
  assert.equal(isParkedHtml("<body><nav><a href='/happy-hour'>Happy Hour</a></nav> lots of real content here ".repeat(20) + "</body>"), false));

// extractHhSignalLinks
check("finds /happy-hour link, resolved absolute", () => {
  const links = extractHhSignalLinks('<a href="/happy-hour">HH</a><a href="/about">About</a>', "https://brix.com/");
  assert.deepEqual(links, ["https://brix.com/happy-hour"]);
});
check("finds drink menu + dedupes", () => {
  const links = extractHhSignalLinks(
    '<a href="/drink-menu">Drinks</a><a href="/drink-menu">Drinks</a><a href="/menus">Menus</a>',
    "https://x.com/",
  );
  assert.deepEqual(links.sort(), ["https://x.com/drink-menu", "https://x.com/menus"]);
});
check("anchor text 'Happy Hour' counts even with opaque href", () => {
  const links = extractHhSignalLinks('<a href="/p/123">Happy Hour Specials</a>', "https://x.com/");
  assert.deepEqual(links, ["https://x.com/p/123"]);
});

// resolveEnrichAction — the decision matrix
const real = (r: "ok" | "dead" | "parked", hh: string[] = []): SiteVerdict => ({
  kind: "real", url: "http://x.com", reachability: r, hhSignalUrls: hh,
  decision: r === "ok" ? "extract" : "kill", reason: r,
});
check("real+ok → extract", () =>
  assert.equal(resolveEnrichAction(real("ok"), 0.6).action, "extract"));
check("real+dead → kill", () =>
  assert.equal(resolveEnrichAction(real("dead"), 0.9).action, "kill"));
check("real+parked → kill", () =>
  assert.equal(resolveEnrichAction(real("parked"), 0.9).action, "kill"));
check("social_only → stub", () =>
  assert.equal(resolveEnrichAction(
    { kind: "social_only", url: "http://fb", reachability: null, hhSignalUrls: [], decision: "stub", reason: "social" }, 0.9
  ).action, "stub"));
check("no-site, likelihood>0.5 → extract (go for it)", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, 0.62
  ).action, "extract"));
check("no-site, likelihood<=0.5 → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, 0.33
  ).action, "kill"));
check("no-site, likelihood null → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, null
  ).action, "kill"));

// siteVerdictFromFetch — reachability from a fetch outcome.
// SACRED: a timeout/abort is NOT a dead site — a slow-but-real site (e.g. a heavy
// homepage that takes >5s) must NEVER be killed. Only true network failure (DNS /
// refused) or a server/4xx-gone status may kill.
check("timeout outcome → keep as stub (never kill)", () => {
  const v = siteVerdictFromFetch("http://slowsite.com/", { kind: "timeout" });
  assert.equal(v.decision, "stub");
  assert.notEqual(v.reachability, "dead");
});
check("unreachable (DNS/refused) → kill", () => {
  const v = siteVerdictFromFetch("http://gone.example/", { kind: "unreachable" });
  assert.equal(v.reachability, "dead");
  assert.equal(v.decision, "kill");
});
// SACRED: a TLS cert error / connection reset means a SERVER EXISTS but Node can't
// read it (browsers/curl can) — e.g. Hillstone's UNABLE_TO_VERIFY_LEAF_SIGNATURE.
// That is NOT a dead site; it must be kept as a stub, never killed.
check("blocked (TLS/reset) → keep as stub (never kill)", () => {
  const v = siteVerdictFromFetch("https://hillstone.com/", { kind: "blocked" });
  assert.equal(v.decision, "stub");
  assert.notEqual(v.reachability, "dead");
});
// classifyFetchError: only a non-resolving / refused domain is truly dead.
check("classifyFetchError: AbortError → timeout", () => {
  const e = new Error("aborted"); e.name = "AbortError";
  assert.equal(classifyFetchError(e), "timeout");
});
check("classifyFetchError: ENOTFOUND → unreachable", () =>
  assert.equal(classifyFetchError(fetchErr("ENOTFOUND")), "unreachable"));
check("classifyFetchError: ECONNREFUSED → unreachable", () =>
  assert.equal(classifyFetchError(fetchErr("ECONNREFUSED")), "unreachable"));
check("classifyFetchError: TLS cert error → blocked (not unreachable)", () =>
  assert.equal(classifyFetchError(fetchErr("UNABLE_TO_VERIFY_LEAF_SIGNATURE")), "blocked"));
check("classifyFetchError: ECONNRESET → blocked", () =>
  assert.equal(classifyFetchError(fetchErr("ECONNRESET")), "blocked"));
// isParkedHtml must NOT flag a JS/SPA shell (minimal server HTML, hydrates client-side)
// as parked — Brix (84 bytes) and LongHorn served 200 but were wrongly killed.
check("JS/SPA shell (no parking marker) is NOT parked", () =>
  assert.equal(isParkedHtml("<html><head><script>var x=1;</script></head><body><div id='root'></div></body></html>"), false));
check("tiny 200 body without marker is NOT parked", () =>
  assert.equal(isParkedHtml("<!doctype html><title>Brix</title><div id=app></div>"), false));
check("200 reachable → extract + collects HH-signal links", () => {
  const v = siteVerdictFromFetch("https://brix.com/", {
    kind: "response",
    status: 200,
    html: "<a href='/happy-hour'>Happy Hour</a> lots of real content ".repeat(20),
    finalUrl: "https://brix.com/",
  });
  assert.equal(v.decision, "extract");
  // Multi-source discovery: the CONFIRMED anchor link ranks first, then path guesses
  // fill remaining slots (so we probe /menu, /bar-menu, etc. even when unlinked).
  assert.equal(v.hhSignalUrls[0], "https://brix.com/happy-hour", "confirmed link first");
  assert.ok(v.hhSignalUrls.includes("https://brix.com/menu"), "guesses included");
  assert.ok(v.hhSignalUrls.length > 1, "casts a wide net");
});
check("menu PDFs ranked by HH relevance — HH menu beats breakfast/lunch (Vix Creek bug)", () => {
  // Page links breakfast/lunch/dinner PDFs BEFORE the happy-hour PDF (real page order).
  // The bounded doc budget downstream means order decides what reaches the model, so the
  // HH menu must rank ahead of the generic menus despite appearing later in the HTML.
  const html =
    "<a href='/s/BREAKFAST-MENU.pdf'>Breakfast</a>" +
    "<a href='/s/LUNCH-MENU.pdf'>Lunch</a>" +
    "<a href='/s/DINNER-MENU.pdf'>Dinner</a>" +
    "<a href='/s/Happy-Hour-Menu.pdf'>Happy Hour</a> real content ".repeat(20);
  const v = siteVerdictFromFetch("https://vix.com/", {
    kind: "response", status: 200, html, finalUrl: "https://vix.com/",
  });
  const pdfs = v.hhSignalUrls.filter((u) => u.endsWith(".pdf"));
  assert.equal(pdfs[0], "https://vix.com/s/Happy-Hour-Menu.pdf", "HH PDF ranks first among docs");
  assert.ok(
    pdfs.indexOf("https://vix.com/s/Happy-Hour-Menu.pdf") <
      pdfs.indexOf("https://vix.com/s/BREAKFAST-MENU.pdf"),
    "HH PDF ahead of breakfast PDF",
  );
});
check("Wix image de-thumbnailed to full-res; signal matched on original name (Shell Beach bug)", () => {
  const thumb =
    "https://static.wixstatic.com/media/f6f818_abc~mv2.jpg/v1/fill/w_147,h_190,blur_2,enc_avif/SBB%20Happy%20Hour.jpg";
  assert.equal(fullResImageUrl(thumb), "https://static.wixstatic.com/media/f6f818_abc~mv2.jpg");
  // end-to-end through extractMediaLinks: the HH flyer is kept (name carries the signal) AND
  // stored as the full-res original (no /v1/ transform), not the blurred thumbnail.
  const links = extractMediaLinks(`<img src="${thumb}" alt="">`, "https://x.com/");
  assert.deepEqual(links, ["https://static.wixstatic.com/media/f6f818_abc~mv2.jpg"]);
  // a non-Wix url is untouched
  assert.equal(fullResImageUrl("https://x.com/menu.jpg"), "https://x.com/menu.jpg");
});
check("500 server error → kill (dead)", () => {
  const v = siteVerdictFromFetch("https://x.com/", { kind: "response", status: 503, html: "", finalUrl: "https://x.com/" });
  assert.equal(v.decision, "kill");
  assert.equal(v.reachability, "dead");
});
check("404 gone → kill (dead)", () => {
  const v = siteVerdictFromFetch("https://x.com/", { kind: "response", status: 404, html: "", finalUrl: "https://x.com/" });
  assert.equal(v.decision, "kill");
});
check("200 parked domain → kill (parked)", () => {
  const v = siteVerdictFromFetch("https://x.com/", {
    kind: "response",
    status: 200,
    html: "<title>x.com is for sale</title><body>Buy this domain</body>",
    finalUrl: "https://x.com/",
  });
  assert.equal(v.decision, "kill");
  assert.equal(v.reachability, "parked");
});
check("403 bot-block → extract (reachable, not killed)", () => {
  const v = siteVerdictFromFetch("https://x.com/", { kind: "response", status: 403, html: "", finalUrl: "https://x.com/" });
  assert.equal(v.decision, "extract");
});

console.log(`\n${passed} checks passed.`);
