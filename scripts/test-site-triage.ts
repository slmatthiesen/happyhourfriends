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
  cappedSquarespaceImageUrl,
  resolveEnrichAction,
  siteVerdictFromFetch,
  pickDeclaredPages,
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
  kind: "real", url: "http://x.com", reachability: r, hhSignalUrls: hh, confirmedHhUrls: hh,
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
    { kind: "social_only", url: "http://fb", reachability: null, hhSignalUrls: [], confirmedHhUrls: [], decision: "stub", reason: "social" }, 0.9
  ).action, "stub"));
check("no-site, likelihood>0.5 → extract (go for it)", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], confirmedHhUrls: [], decision: "kill", reason: "no site on file" }, 0.62
  ).action, "extract"));
check("no-site, likelihood<=0.5 → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], confirmedHhUrls: [], decision: "kill", reason: "no site on file" }, 0.33
  ).action, "kill"));
check("no-site, likelihood null → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], confirmedHhUrls: [], decision: "kill", reason: "no site on file" }, null
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
check("JSON-LD MenuSection image is harvested (Limón / getbento bug)", () => {
  // The HH menu lives in schema.org JSON-LD as an image on a CDN — no <a>/<img> tag for the
  // old scanner to find. extractMediaLinks must read ld+json menu blocks.
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Menu",
    hasMenuSection: {
      "@type": "MenuSection",
      name: "Happy Hour M-F 3-6pm",
      hasMenuItem: { "@type": "MenuItem", image: { url: "https://images.getbento.com/accounts/x/media/images/15432happy_hour_1.png?w=1800&fit=max" } },
    },
  })}</script>`;
  const links = extractMediaLinks(html, "https://www.limonrestaurants.com/menus/");
  assert.ok(
    links.some((u) => u.startsWith("https://images.getbento.com/accounts/x/media/images/15432happy_hour_1.png")),
    `expected getbento menu image, got ${JSON.stringify(links)}`,
  );
});
check("JSON-LD menu PDF is harvested even with a generic filename (menu context)", () => {
  const html = `<script type='application/ld+json'>{"@type":"Restaurant","hasMenu":{"@type":"Menu","url":"https://cdn.example.com/files/2026-doc.pdf"}}</script>`;
  const links = extractMediaLinks(html, "https://r.com/");
  assert.deepEqual(links, ["https://cdn.example.com/files/2026-doc.pdf"]);
});
check("JSON-LD WITHOUT menu context does not harvest a logo image", () => {
  const html = `<script type="application/ld+json">{"@type":"Organization","logo":{"url":"https://cdn.example.com/brand/logo.png"}}</script>`;
  assert.deepEqual(extractMediaLinks(html, "https://r.com/"), []);
});
check("page-JSON escaped relative PDF is harvested (Square Online / Hula Hoops bug)", () => {
  // Square Online embeds the menu PDF in its own page-data JSON as an ESCAPED, RELATIVE path
  // with a space in the filename — no <a>/<img>/ld+json tag for the other scanners. The link
  // must be unescaped (\/ → /) and resolved against the base URL.
  const html = `<script>{"section":{"content":"\\/uploads\\/b\\/6dd5\\/Hula-Hoops-Dinner Menu PDF.pdf"}}</script>`;
  const links = extractMediaLinks(html, "https://www.myhulahoops.com/");
  assert.ok(
    links.some((u) => decodeURI(u) === "https://www.myhulahoops.com/uploads/b/6dd5/Hula-Hoops-Dinner Menu PDF.pdf"),
    `expected resolved Square PDF, got ${JSON.stringify(links)}`,
  );
});
check("HH-context doc ranks before a non-HH menu doc (Hula Hoops dinner vs brunch)", () => {
  // The HH heading sits in the page JSON just above the linked menu PDF: the Dinner PDF is
  // preceded by "Happy Hour Mon-Fri 3:00pm-5:30pm", the Brunch PDF by "Bottomless Mimosa".
  // Both filenames score 0, so without context the budget spent on the wrong (brunch) menu.
  const html =
    `<script>{"a":{"insert":"Bottomless Mimosa\\n"},"img":{"link":{"file":"\\/uploads\\/Hula-Hoops-Brunch-Menu.pdf"}}},` +
    `{"b":{"insert":"Happy Hour Mon-Fri 3:00pm-5:30pm\\n"},"img":{"link":{"file":"\\/uploads\\/Hula-Hoops-Dinner Menu PDF.pdf"}}}</script>`;
  const links = extractMediaLinks(html, "https://www.myhulahoops.com/");
  assert.ok(
    decodeURI(links[0]).endsWith("Hula-Hoops-Dinner Menu PDF.pdf"),
    `expected the HH-context Dinner PDF first, got ${JSON.stringify(links)}`,
  );
});
check("page-JSON escaped relative menu image is harvested", () => {
  const html = `<script>{"img":"\\/uploads\\/happy-hour-flyer.jpg"}</script>`;
  assert.ok(extractMediaLinks(html, "https://r.com/").includes("https://r.com/uploads/happy-hour-flyer.jpg"));
});
check("page-JSON PDF without a menu/HH signal is ignored (no noise)", () => {
  const html = `<script>{"x":"\\/files\\/privacy-policy.pdf"}</script>`;
  assert.deepEqual(extractMediaLinks(html, "https://r.com/"), []);
});
// Squarespace button block: the HH menu PDF is a clickthroughUrl to an EXTENSIONLESS /s/
// file redirect, with the "happy hour" signal in the button label just before it. Neither the
// anchor scanner (no .pdf) nor ld+json sees it. Fate Brewing's 19MB HH menu lived here.
check("Squarespace clickthroughUrl /s/ menu link with HH-signal label is harvested", () => {
  const html = `<p>VIEW HAPPY HOUR MENU</p>","clickthroughUrl":{"url":"/s/Fate-Happy-Hour-Menu"},"x":1`;
  assert.deepEqual(extractMediaLinks(html, "https://www.fatebrewing.com/phoenix-location"), [
    "https://www.fatebrewing.com/s/Fate-Happy-Hour-Menu",
  ]);
});
check("Squarespace clickthroughUrl signal can come from the slug itself", () => {
  const html = `"clickthroughUrl":{"url":"https://static1.squarespace.com/static/abc123/t/deadbeef/1700000000000/Drink-Specials"}`;
  assert.deepEqual(extractMediaLinks(html, "https://r.com/"), [
    "https://static1.squarespace.com/static/abc123/t/deadbeef/1700000000000/Drink-Specials",
  ]);
});
check("clickthroughUrl to a non-Squarespace / non-file target is ignored", () => {
  const html = `<p>Happy Hour</p>","clickthroughUrl":{"url":"/reservations"}`;
  assert.deepEqual(extractMediaLinks(html, "https://r.com/"), []);
});
check("Squarespace /s/ clickthrough with NO menu signal is ignored", () => {
  const html = `<p>Gift Cards</p>","clickthroughUrl":{"url":"/s/Buy-A-Card"}`;
  assert.deepEqual(extractMediaLinks(html, "https://r.com/"), []);
});
// Squarespace CDN images carry a ?format=<N>w width. A high-res menu image (2500w, ~8MB)
// blows the 10MB-base64 API image cap; cap it at 1500w (the model downscales to ~1568px anyway).
check("caps an oversized Squarespace CDN image format to 1500w", () => {
  const u = cappedSquarespaceImageUrl(
    "https://images.squarespace-cdn.com/content/v1/abc/x/Classics+%288.5+x+14+in%29.png?format=2500w",
  );
  assert.match(u, /format=1500w/);
  assert.match(u, /Classics\+%288\.5\+x\+14\+in%29\.png/, "preserves the path filename verbatim");
});
check("leaves an already-small Squarespace format untouched", () => {
  const small = "https://images.squarespace-cdn.com/content/v1/abc/x/menu.png?format=1000w";
  assert.equal(cappedSquarespaceImageUrl(small), small);
});
check("caps a Squarespace image with no format param", () => {
  assert.match(
    cappedSquarespaceImageUrl("https://images.squarespace-cdn.com/content/v1/abc/x/menu.png"),
    /format=1500w/,
  );
});
check("leaves non-Squarespace image URLs untouched", () => {
  const other = "https://cdn.example.com/menu.png?format=2500w";
  assert.equal(cappedSquarespaceImageUrl(other), other);
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

// --- pickDeclaredPages (Bug C/D: declared pages + opaque content slugs) ---
check("pickDeclaredPages keeps keyword pages AND opaque content slugs (Wix /about-3-1)", () => {
  const sitemap = [
    "https://sp.com/about-3-4",
    "https://sp.com/about-3-1", // the events/HH page — scoreHhUrl 0, must survive
    "https://sp.com/cocktails", // drinks → scoreHhUrl 60
    "https://sp.com/cart", // noise → dropped
    "https://sp.com/privacy", // noise → dropped
    "https://other.com/menu", // cross-origin → dropped
  ];
  const picked = pickDeclaredPages(sitemap, "https://sp.com/", 6);
  assert.equal(picked[0], "https://sp.com/cocktails", "keyword page ranks first");
  assert.ok(picked.includes("https://sp.com/about-3-1"), "opaque about-3-1 kept");
  assert.ok(!picked.some((u) => /cart|privacy/.test(u)), "cart/privacy dropped");
  assert.ok(!picked.some((u) => u.startsWith("https://other")), "cross-origin dropped");
});
check("pickDeclaredPages respects the limit", () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://sp.com/about-${i}`);
  assert.equal(pickDeclaredPages(many, "https://sp.com/", 6).length, 6);
});

// --- siteVerdictFromFetch with sitemap URLs (declared pages reach the candidate list) ---
check("declared sitemap page (no anchor in raw HTML) becomes a candidate, ahead of guesses", () => {
  // A Wix-style page: raw HTML has no <a href="/about-3-1"> (JS nav), but the sitemap does.
  const v = siteVerdictFromFetch(
    "https://sp.com/",
    { kind: "response", status: 200, html: "<html><body>JS shell</body></html>", finalUrl: "https://sp.com/" },
    ["https://sp.com/about-3-1", "https://sp.com/cocktails"],
  );
  assert.equal(v.decision, "extract");
  const idxAbout = v.hhSignalUrls.indexOf("https://sp.com/about-3-1");
  const idxGuess = v.hhSignalUrls.indexOf("https://sp.com/happy-hour"); // a pure guess
  assert.ok(idxAbout >= 0, "declared /about-3-1 present in candidates");
  assert.ok(idxGuess === -1 || idxAbout < idxGuess, "declared page ranks ahead of guessed /happy-hour");
});

// --- confirmedHhUrls: the set the render-escalation detector may PAY to read. Anchor
// links / Wix routes / sitemap pages are CONFIRMED; GUESS_MENU_PATHS are NOT (Webflow/Wix
// soft-404 a guessed /happy-hour-menu to a 200 catch-all → paying to read a guess was the
// Oakland $1.09/6%-hit-rate waste). hhSignalUrls keeps the guesses (free HTTP pass probes them).
check("confirmedHhUrls includes the anchor-linked HH page, excludes a pure guess", () => {
  const v = siteVerdictFromFetch("https://brix.com/", {
    kind: "response", status: 200,
    html: "<a href='/happy-hour-menu'>Happy Hour</a> lots of real content ".repeat(20),
    finalUrl: "https://brix.com/",
  });
  assert.ok(v.confirmedHhUrls.includes("https://brix.com/happy-hour-menu"), "anchor-linked HH page is confirmed");
  assert.ok(v.hhSignalUrls.includes("https://brix.com/happy-hour"), "guessed /happy-hour still in hhSignalUrls (free pass probes it)");
  assert.ok(!v.confirmedHhUrls.includes("https://brix.com/happy-hour"), "guessed /happy-hour is NOT confirmed");
});
check("confirmedHhUrls includes a sitemap-declared page, excludes guesses", () => {
  const v = siteVerdictFromFetch(
    "https://sp.com/",
    { kind: "response", status: 200, html: "<html><body>JS shell</body></html>", finalUrl: "https://sp.com/" },
    ["https://sp.com/cocktails"],
  );
  assert.ok(v.confirmedHhUrls.includes("https://sp.com/cocktails"), "sitemap-declared /cocktails is confirmed");
  assert.ok(!v.confirmedHhUrls.includes("https://sp.com/happy-hour"), "guessed /happy-hour is NOT confirmed");
});
check("confirmedHhUrls includes an anchor-linked menu PDF (real doc, not a guess)", () => {
  const v = siteVerdictFromFetch("https://x.com/", {
    kind: "response", status: 200,
    html: "<a href='/s/Happy-Hour-Menu.pdf'>Happy Hour</a> real content ".repeat(20),
    finalUrl: "https://x.com/",
  });
  assert.ok(v.confirmedHhUrls.includes("https://x.com/s/Happy-Hour-Menu.pdf"), "linked HH PDF is confirmed");
});
check("resolveEnrichAction surfaces confirmedHhUrls to the detector", () => {
  const v = siteVerdictFromFetch("https://brix.com/", {
    kind: "response", status: 200,
    html: "<a href='/happy-hour-menu'>HH</a> content ".repeat(20),
    finalUrl: "https://brix.com/",
  });
  assert.deepEqual(resolveEnrichAction(v, 0.6).confirmedHhUrls, v.confirmedHhUrls);
});
check("bot-blocked (non-200) → confirmedHhUrls empty (no confirmed links were readable)", () => {
  const v = siteVerdictFromFetch("https://x.com/", { kind: "response", status: 403, html: "", finalUrl: "https://x.com/" });
  assert.deepEqual(v.confirmedHhUrls, []);
  assert.ok(v.hhSignalUrls.length > 0, "still probes guesses for the free pass");
});
check("dead/stub verdicts carry an empty confirmedHhUrls", () => {
  assert.deepEqual(siteVerdictFromFetch("http://gone/", { kind: "unreachable" }).confirmedHhUrls, []);
  assert.deepEqual(siteVerdictFromFetch("http://slow/", { kind: "timeout" }).confirmedHhUrls, []);
});

console.log(`\n${passed} checks passed.`);
