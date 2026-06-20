/**
 * siteTriage — classify a candidate's web presence so the enrich pipeline can
 * KILL dead/parked/no-site listings (instead of stubbing them) and POINT the
 * extractor at a venue's own happy-hour/menu links.
 *
 * Pure helpers (classifyUrl / isParkedHtml / extractHhSignalLinks /
 * resolveEnrichAction) are unit-tested. triageSite is the network orchestrator
 * (plain Node fetch — NOT a Claude tool, so it is allowed in a tsx script).
 *
 * SACRED: we kill only on an invalid SITE. A reachable site with no extractable
 * times stays a stub — that is the extractor-recall-gap safety net.
 */

import { scoreHhUrl } from "@/lib/places/hhText";
import { discoverSitemapUrls, type TextFetcher } from "@/lib/places/sitemap";

export type SiteKind = "real" | "social_only" | "none";
export type Reachability = "ok" | "dead" | "parked" | "timeout";

/**
 * The outcome of trying to fetch a site. Only `unreachable` (the domain doesn't
 * resolve or refuses all connections) means the site is actually DEAD. `timeout`
 * (slow/heavy real site) and `blocked` (a server answers but Node can't read it —
 * TLS cert-chain error, connection reset, bot wall) both mean a site EXISTS, so
 * SACRED — we never kill on those, only keep as a stub.
 */
export type FetchOutcome =
  | { kind: "response"; status: number; html: string; finalUrl: string }
  | { kind: "timeout" }
  | { kind: "unreachable" }
  | { kind: "blocked" };

/**
 * Map a thrown fetch error onto an outcome. Only a non-resolving (ENOTFOUND /
 * EAI_AGAIN) or actively-refused (ECONNREFUSED) domain is treated as dead. TLS
 * errors, resets, protocol errors, etc. mean a server is present but unreadable
 * by Node (browsers/curl succeed — e.g. hillstone.com's UNABLE_TO_VERIFY_LEAF_
 * SIGNATURE) → `blocked`, never killed. Pure + exported for unit testing.
 */
export function classifyFetchError(err: unknown): "timeout" | "unreachable" | "blocked" {
  const e = err as { name?: string; cause?: { code?: string } };
  if (e?.name === "AbortError") return "timeout";
  const code = e?.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNREFUSED") return "unreachable";
  return "blocked";
}

export interface SiteVerdict {
  kind: SiteKind;
  url: string | null;
  reachability: Reachability | null;
  /** All candidate pages worth a FREE fetch — confirmed pages PLUS speculative path guesses. */
  hhSignalUrls: string[];
  /** The subset of hhSignalUrls that are CONFIRMED to exist — anchor links, Wix routes,
   *  sitemap-declared pages, and linked menu docs — with `GUESS_MENU_PATHS` removed. Only these
   *  may trigger a PAID render-escalation (a guessed path soft-404s to a 200 catch-all, which is
   *  what made the audit escalation expensive). Empty when the page wasn't readable. */
  confirmedHhUrls: string[];
  decision: "extract" | "stub" | "kill";
  reason: string;
}

// Hosts that are social/ordering presences, not a real first-party site. Keep as
// stubs (valid crowdsource targets) — never kill, never treat as extractable.
const SOCIAL_OR_ORDERING_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linktr.ee",
  "linktree",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "toasttab.com",
  "spoton.com",
  "orders.co",
  "order.spoton.com",
  "mobile-webview",
  "square.site",
  "rebrand.ly",
];

const PARKED_MARKERS = [
  "is for sale",
  "buy this domain",
  "domain for sale",
  "this domain is parked",
  "sedoparking",
  "bodis.com",
  "domain is currently available",
  "godaddy.com/domainsearch",
];

// URL-shaped substrings that signal a happy-hour or menu page (matched against the HREF).
const HH_LINK_PATTERNS = [
  /happy[-_ ]?hour/i,
  /specials?/i,
  /(beer|drink|cocktail|wine|food)[-_ ]?menu/i,
  /\/menus?\b/i,
  // Deal pages venues name creatively — the HH lives here but the path says none of the
  // above (Milestone Tavern: /happenings carries the HH image; recovered 14 deals once
  // fetched). Kept tight to deal-ish nouns so we don't pull in /events catering pages.
  /happenings?/i,
  /\b(deals?|offers?)\b/i,
];

// Visible ANCHOR-TEXT a human clicks for a menu/HH page — the strongest signal, because
// the href is so often opaque (a qrco.de/bit.ly shortlink, a PDF hash, a Squarespace /s/
// asset id). Keying menu discovery off the URL alone was the bug that dropped venues whose
// homepage had a plain "View Menu" button (e.g. Wooly's → qrco.de → a CDN PDF with the HH).
// We follow whatever these point at; fetchUrl chases redirects and detects the final PDF.
const HH_TEXT_PATTERNS = [
  /happy[-\s]?hour/i,
  /\bspecials?\b/i,
  /\bmenus?\b/i, // "View Menu", "Our Menu", "Food Menu", "Menu"
  /\b(drinks?|cocktails?)\b/i,
  /\bhappenings?\b/i, // creatively-named deal pages (Milestone Tavern)
  /\b(deals?|offers?)\b/i,
];

export function classifyUrl(raw: string | null | undefined): { kind: SiteKind; url: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) return { kind: "none", url: null };
  let host = trimmed.toLowerCase();
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    /* unparseable — fall through to substring check */
  }
  if (SOCIAL_OR_ORDERING_HOSTS.some((h) => host.includes(h))) {
    return { kind: "social_only", url: trimmed };
  }
  return { kind: "real", url: trimmed };
}

export function isParkedHtml(html: string): boolean {
  const lower = html.toLowerCase();
  // Markers ONLY. A prior <80-char visible-text floor over-fired on JS/SPA shells
  // (Brix served 84 bytes, LongHorn an SSR shell) — both real sites, wrongly killed
  // as "parked". A genuinely parked domain carries one of these registrar markers;
  // anything else is reachable and (worst case) yields nothing → stays a stub, never
  // killed. SACRED: never kill a reachable site.
  return PARKED_MARKERS.some((m) => lower.includes(m));
}

export function extractHhSignalLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").trim();
    // A link qualifies if its HREF looks menu-ish OR its visible TEXT says menu/HH/specials.
    const hit =
      HH_LINK_PATTERNS.some((re) => re.test(href)) ||
      HH_TEXT_PATTERNS.some((re) => re.test(text));
    if (!hit) continue;
    try {
      out.add(new URL(href, baseUrl).toString());
    } catch {
      /* skip unresolvable href */
    }
    if (out.size >= 8) break;
  }
  return [...out];
}

/**
 * Page routes a JS site declares in its embedded model (Wix `pageUriSEO`, etc.).
 * Catches real pages (e.g. /menu) that are never linked as plain <a href> in the
 * server-rendered HTML — exactly how Bottega's happy-hour page hid from us.
 */
export function extractPageRoutes(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /"pageUriSEO":"([^"#?]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1].replace(/^\/+/, "");
    if (!slug || slug === "home") continue;
    try {
      out.add(new URL("/" + slug, baseUrl).toString());
    } catch {
      /* skip */
    }
  }
  return [...out];
}

/**
 * PDF/image menu links in the page — the >50% case where the HH menu is a document,
 * not HTML. A restaurant PDF is almost always a menu (kept regardless of name); images
 * are kept only when the filename/alt looks menu-ish (avoids decorative photos).
 */
const MEDIA_SIGNAL = /menu|happy|hour|\bbar\b|drink|cocktail|special|food|dinner|lunch|brunch|vermut|aperitivo|apericena/i;

/**
 * Wix (and similar) embed a tiny BLURRED thumbnail in the served HTML —
 * `…/media/<id>~mv2.jpg/v1/fill/w_147,h_190,…,blur_2,…/Happy-Hour.jpg` — which the vision
 * model can't read (Shell Beach Brewhouse's HH flyer came through as a 147px blur). Strip the
 * `/v1/…` transform to the full-res original (`…~mv2.jpg`). NOTE: the human-readable filename
 * (which carries the "happy hour" signal) lives in the TRANSFORM suffix, so callers must test
 * MEDIA_SIGNAL on the ORIGINAL url and de-thumbnail only when storing the link to fetch.
 */
export function fullResImageUrl(url: string): string {
  const wix = url.match(/^(https?:\/\/static\.wixstatic\.com\/media\/[^/]+\.(?:jpe?g|png|webp|gif|avif))\/v1\//i);
  return wix ? wix[1] : url;
}

/**
 * Cap a Squarespace CDN image's `?format=<N>w` width. Squarespace serves menu images from
 * images.squarespace-cdn.com at up to format=2500w (~8MB) — which exceeds the Claude API's
 * 10MB-base64 per-image cap (8MB raw → ~10.7MB base64) AND wastes tokens, since the model
 * downscales every image to ~1568px on the long edge anyway. Cap the width at 1500w: at least
 * the downscale target for any orientation, ~5.6MB raw (~7.5MB base64, safely under 10MB).
 * Only ever LOWERS resolution (the inverse of fullResImageUrl, which de-thumbnails Wix images —
 * different CDN, opposite direction). Non-Squarespace URLs and already-smaller formats pass
 * through untouched. Sidecar Social Club's 8MB HH menu image was dropped without this.
 */
export function cappedSquarespaceImageUrl(url: string, maxWidth = 1500): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!/(^|\.)images\.squarespace-cdn\.com$/i.test(u.hostname)) return url;
  const widthMatch = u.searchParams.get("format")?.match(/^(\d+)w$/i);
  if (widthMatch && Number(widthMatch[1]) <= maxWidth) return url; // already small enough
  u.searchParams.set("format", `${maxWidth}w`); // no format, format=original, or wider → cap
  return u.toString();
}

export function extractMediaLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const abs = (u: string) => { try { return new URL(u, baseUrl).toString(); } catch { return null; } };

  // <a href="…pdf"> (any PDF) and <a href="…jpg/png/webp"> with a menu signal.
  const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ");
    const isPdf = /\.pdf(\?|#|$)/i.test(href);
    const isImg = /\.(jpe?g|png|webp)(\?|#|$)/i.test(href);
    if (isPdf || (isImg && (MEDIA_SIGNAL.test(href) || MEDIA_SIGNAL.test(text)))) {
      const u = abs(isPdf ? href : fullResImageUrl(href)); // signal matched on original; fetch full-res
      if (u) out.add(u);
    }
  }
  // <img src="…"> whose filename or alt suggests a menu.
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (!src || !/\.(jpe?g|png|webp)(\?|#|$)/i.test(src)) continue;
    if (MEDIA_SIGNAL.test(src) || MEDIA_SIGNAL.test(alt)) {
      const u = abs(fullResImageUrl(src)); // signal matched on original src; fetch full-res
      if (u) out.add(u);
    }
  }
  // JSON-LD (schema.org) menus — getbento / BentoBox / Squarespace embed the HH menu as an
  // image or PDF inside <script type="application/ld+json"> Menu/MenuSection data, with NO
  // <a>/<img> tag for the scanners above to find (Limón's HH lived in a getbento MenuSection
  // image; initial enrich got the window text but never the deals). Harvest media URLs from
  // ld+json blocks that carry menu CONTEXT — the schema type is the signal, so a generically
  // named menu image is kept; a NOISE filter still drops logos/heroes sharing the block.
  const ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const MENU_CONTEXT = /\bMenu\b|hasMenu|MenuSection|MenuItem/i;
  const MEDIA_URL = /https?:\/\/[^\s"'\\<>]+\.(?:pdf|jpe?g|png|webp)(?:\?[^\s"'\\<>]*)?/gi;
  const MEDIA_NOISE = /logo|favicon|sprite|avatar|\bicon\b|background|banner|hero\b/i;
  while ((m = ldRe.exec(html)) !== null) {
    const block = m[1];
    if (!MENU_CONTEXT.test(block)) continue;
    let um: RegExpExecArray | null;
    while ((um = MEDIA_URL.exec(block)) !== null) {
      const raw = um[0].replace(/&amp;/gi, "&");
      if (MEDIA_NOISE.test(raw)) continue;
      const isPdf = /\.pdf(\?|$)/i.test(raw);
      const u = abs(isPdf ? raw : fullResImageUrl(raw));
      if (u) out.add(u);
    }
  }
  // Generic page-builder JSON (Square Online, Wix, Squarespace, …): the menu PDF/image URL is
  // embedded in the builder's own page-data JSON, NOT an <a>/<img>/ld+json tag the scanners
  // above can see, and often as an ESCAPED, RELATIVE path with spaces in the filename
  // (Hula Hoops/Square: "\/uploads\/…\/Hula-Hoops-Dinner Menu PDF.pdf"). Unescape, then keep
  // any quoted media path whose name carries a menu/HH signal (NOISE filter still drops
  // logos/heroes; document context isn't available here, so the filename signal is required).
  const unescaped = html.replace(/\\\//g, "/");
  const QUOTED_MEDIA = /["']([^"'<>]+?\.(?:pdf|jpe?g|png|webp))(\?[^"'<>]*)?["']/gi;
  let qm: RegExpExecArray | null;
  while ((qm = QUOTED_MEDIA.exec(unescaped)) !== null) {
    const raw = (qm[1] + (qm[2] ?? "")).replace(/&amp;/gi, "&");
    if (MEDIA_NOISE.test(raw) || !MEDIA_SIGNAL.test(raw)) continue;
    const isPdf = /\.pdf(\?|$)/i.test(raw);
    const u = abs(isPdf ? raw : fullResImageUrl(raw));
    if (u) out.add(u);
  }
  // Squarespace BUTTON BLOCKS link an uploaded menu PDF via a clickthroughUrl in block JSON —
  // {"clickthroughUrl":{"url":"/s/Fate-Happy-Hour-Menu"}} — not an <a>/<img>/ld+json, and the
  // target is an EXTENSIONLESS Squarespace file redirect (/s/… or static1…/t/…), so neither the
  // anchor scanner nor the `.pdf` test above can see it. Follow it when the slug or its button
  // label carries a menu/HH signal; fetchUrl resolves the 302 and detects the PDF by
  // content-type. Fate Brewing's 19MB HH menu lived here, invisible → a bare window.
  const SQSP_FILE_LINK = /^(?:\/s\/|https?:\/\/static1\.squarespace\.com\/static\/[a-f0-9]+\/t\/)/i;
  const ctRe = /"clickthroughUrl"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/gi;
  while ((m = ctRe.exec(html)) !== null) {
    const href = m[1].replace(/\\\//g, "/");
    if (!SQSP_FILE_LINK.test(href)) continue;
    if (/\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(href)) continue; // an image target is handled above
    const label = html.slice(Math.max(0, m.index - 160), m.index).replace(/<[^>]+>/g, " ");
    if (MEDIA_SIGNAL.test(href) || MEDIA_SIGNAL.test(label)) {
      const u = abs(href);
      if (u) out.add(u);
    }
  }
  return [...out].slice(0, 6);
}

/** Common HH/menu paths to PROBE even when nothing links them (most→least specific).
 *  When adding HH-specific paths here, check `ownSiteHhProbe.OWN_SITE_HH_PATHS` — it is a
 *  deliberate subset of these (the generic /menu, /drinks, /cocktails paths are excluded
 *  because they're too generic to count as a happy-hour page on their own). */
export const GUESS_MENU_PATHS = [
  "/happy-hour", "/happyhour", "/happy-hour-menu", "/menu/happy-hour",
  // Multilingual HH pages (Iberia's was /vermut-hour/): probe these too — ethnic venues
  // label their happy hour in their own language (Spanish vermut/hora-feliz, Italian aperitivo).
  "/vermut-hour", "/hora-feliz", "/aperitivo", "/apericena",
  "/specials", "/bar-menu", "/drink-menu", "/drinks", "/cocktails",
  "/menu", "/menus", "/food-menu",
];

export function guessMenuUrls(baseUrl: string): string[] {
  try {
    const origin = new URL(baseUrl).origin;
    return GUESS_MENU_PATHS.map((p) => origin + p);
  } catch {
    return [];
  }
}

// Same-origin pages worth reading for HH even when the URL carries NO menu keyword.
// Wix (and similar) auto-name a venue's events/HH page with an opaque slug like
// `/about-3-1` — scoreHhUrl scores it 0, so the old `scoreHhUrl(u) > 0` filter dropped
// it and the page (which holds the HH) was never fetched. CONTENT_HINT keeps such pages;
// PAGE_NOISE drops cart/account/legal/ordering routes that never carry HH.
const CONTENT_HINT =
  /about|event|special|menu|food|drink|dining|cocktail|happy|hour|deal|brunch|lunch|dinner|\bbar\b|vermut|aperitivo|apericena|hora[-_ ]?feliz/i;
const PAGE_NOISE =
  /\/(cart|checkout|account|login|sign-?in|register|privacy|terms|gift|careers?|jobs?|contact|reservations?|order-online|form-confirmation|sitemap)\b/i;

/**
 * From a pool of declared URLs (a sitemap, or a site's embedded routes), pick the
 * same-origin pages most worth fetching for happy-hour info: keyword pages first
 * (scoreHhUrl), then about/events/dining-type pages, dropping obvious non-content.
 * Pure + exported for unit testing.
 */
export function pickDeclaredPages(urls: string[], baseUrl: string, limit = 6): string[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const scored = urls
    .filter((u) => {
      try {
        return new URL(u).origin === origin;
      } catch {
        return false;
      }
    })
    .filter((u) => !PAGE_NOISE.test(u))
    .map((u) => ({ u, s: scoreHhUrl(u) }))
    .filter((x) => x.s > 0 || CONTENT_HINT.test(x.u))
    .sort((a, b) => b.s - a.s);
  return [...new Set(scored.map((x) => x.u))].slice(0, limit);
}

/** Dedupe + rank candidate URLs most-likely-HH first (see hhText.scoreHhUrl). */
export function rankCandidates(urls: string[], limit = 8): string[] {
  return [...new Set(urls)]
    .map((u) => ({ u, s: scoreHhUrl(u) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.u)
    .slice(0, limit);
}

/** Combine a triage verdict with the venue's HH-likelihood into a final action. */
export function resolveEnrichAction(
  verdict: SiteVerdict,
  likelihood: number | null,
): { action: "extract" | "stub" | "kill"; reason: string; priorityUrls: string[]; confirmedHhUrls: string[] } {
  // No real site on file, but the venue type is promising → "go for it":
  // let the extractor's web_search try to find the site before we give up.
  if (verdict.kind === "none" && likelihood != null && likelihood > 0.5) {
    return { action: "extract", reason: "no site on file but likely HH (>50%)", priorityUrls: [], confirmedHhUrls: [] };
  }
  return { action: verdict.decision, reason: verdict.reason, priorityUrls: verdict.hhSignalUrls, confirmedHhUrls: verdict.confirmedHhUrls };
}

// Real first-party sites can be heavy (a 200 KB homepage took ~12s in the field),
// and the full body read counts against this budget. 5s killed real venues
// (e.g. Peaks & Pints) as "dead"; 15s captures slow-but-real sites.
async function fetchHtml(url: string, ms = 15000): Promise<FetchOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" },
    });
    const html = await res.text();
    return { kind: "response", status: res.status, html, finalUrl: res.url || url };
  } catch (err) {
    // A timeout/blocked is NOT a dead site — only a non-resolving/refused domain is.
    if (ctrl.signal.aborted) return { kind: "timeout" };
    return { kind: classifyFetchError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a fetch outcome onto a reachability verdict (the "real site" branch).
 * Pure + exported so the kill/keep decision is unit-testable without the network.
 *
 * SACRED: a `timeout` is kept as a stub, never killed — a reachable-but-slow site
 * must survive. Only `network` failure, 5xx, or 4xx-gone (404–410) may kill.
 */
export function siteVerdictFromFetch(
  url: string,
  outcome: FetchOutcome,
  sitemapUrls: string[] = [],
): SiteVerdict {
  if (outcome.kind === "timeout") {
    return { kind: "real", url, reachability: "timeout", hhSignalUrls: [], confirmedHhUrls: [], decision: "stub", reason: "slow site (timeout) — kept as stub" };
  }
  if (outcome.kind === "blocked") {
    return { kind: "real", url, reachability: "timeout", hhSignalUrls: [], confirmedHhUrls: [], decision: "stub", reason: "server present but unreadable (TLS/reset) — kept as stub" };
  }
  if (outcome.kind === "unreachable") {
    return { kind: "real", url, reachability: "dead", hhSignalUrls: [], confirmedHhUrls: [], decision: "kill", reason: "dead site (unreachable)" };
  }
  const { status, html, finalUrl } = outcome;
  if (status >= 500 || (status >= 404 && status <= 410)) {
    return { kind: "real", url, reachability: "dead", hhSignalUrls: [], confirmedHhUrls: [], decision: "kill", reason: `dead site (${status})` };
  }
  if (status === 200 && isParkedHtml(html)) {
    return { kind: "real", url, reachability: "parked", hhSignalUrls: [], confirmedHhUrls: [], decision: "kill", reason: "parked domain" };
  }
  // Reachable (incl. 403 bot-block) → extract. Cast a WIDE net for candidate pages
  // from three sources, ranked most-likely-HH first: (1) anchor links in the HTML,
  // (2) the site's declared routes (Wix pageUriSEO — finds /menu that isn't linked),
  // (3) common path guesses (/happy-hour, /menu, /bar-menu, …). fetchPages probes them
  // and silently drops 404s, so over-guessing is cheap and only real pages reach the model.
  // CONFIRMED pages (anchor links + the site's declared menu/HH routes) come FIRST —
  // they're known to exist. Speculative path guesses only FILL remaining slots, so a
  // high-scoring guess (/happy-hour) can't crowd out a real route (/menu).
  let hhSignalUrls: string[];
  let confirmedHhUrls: string[];
  if (status === 200) {
    const media = extractMediaLinks(html, finalUrl); // PDF/image menus — highest value
    // Menu docs (PDF/image), RANKED by happy-hour relevance (scoreHhUrl): happy-hour >
    // specials > drink/cocktail menu > food menu > generic menu > breakfast/lunch/dinner/
    // catering (0). fetchPages' doc budget (5 docs / 3MB) is small, so order matters — we
    // must spend it on the docs most likely to carry HH. The Vix Creek failure: 2 large
    // breakfast PDFs (score 0) sat first in page order and ate the whole budget, so the HH
    // menu (plainly linked) never reached the model. Stable sort keeps page order within a
    // score tier. (sort copies — never mutate extractMediaLinks' result in place.)
    const rankedMedia = [...media].sort((a, b) => scoreHhUrl(b) - scoreHhUrl(a));
    const links = extractHhSignalLinks(html, finalUrl);
    // Embedded routes (Wix pageUriSEO): keep keyword pages AND opaque content slugs
    // (/about-3-1) — not just scoreHhUrl>0, which dropped the latter.
    const routes = pickDeclaredPages(extractPageRoutes(html, finalUrl), finalUrl, 8);
    const confirmed = rankCandidates([...links, ...routes], 8);
    // Pages the site DECLARES in its sitemap — the source of truth, no guessing. These
    // rank ahead of speculative path guesses (a declared /about-3-1 / /scottsdale exists;
    // a guessed /happy-hour usually 404s).
    const declared = pickDeclaredPages(sitemapUrls, finalUrl, 6);
    // 16 (was 12): the multilingual HH guess paths (/vermut-hour, /aperitivo, …) score 100 and
    // would otherwise bump generic /menu out of the net. The extractor's own MAX_FETCH still
    // bounds actual fetches, so a longer priority list costs nothing.
    const guesses = rankCandidates(guessMenuUrls(finalUrl), 16);
    // CONFIRMED = linked docs + anchor/route links + sitemap pages (all known to exist).
    // EXCLUDES `guesses` — only confirmed pages may trigger a PAID escalation downstream.
    confirmedHhUrls = rankCandidates([...rankedMedia, ...confirmed, ...declared], 12);
    hhSignalUrls = [...new Set([...rankedMedia, ...confirmed, ...declared, ...guesses])].slice(0, 16);
  } else {
    hhSignalUrls = guessMenuUrls(url); // bot-blocked: still probe the obvious paths
    confirmedHhUrls = []; // page unreadable → nothing confirmed (guesses must not escalate)
  }
  return { kind: "real", url, reachability: "ok", hhSignalUrls, confirmedHhUrls, decision: "extract", reason: "reachable" };
}

export async function triageSite(input: {
  websiteUri: string | null;
  name: string;
  cityName: string | null;
}): Promise<SiteVerdict> {
  const cls = classifyUrl(input.websiteUri);
  if (cls.kind === "none") {
    return { kind: "none", url: null, reachability: null, hhSignalUrls: [], confirmedHhUrls: [], decision: "kill", reason: "no site on file" };
  }
  if (cls.kind === "social_only") {
    return { kind: "social_only", url: cls.url, reachability: null, hhSignalUrls: [], confirmedHhUrls: [], decision: "stub", reason: "social/ordering link only" };
  }

  const outcome = await fetchHtml(cls.url!);

  // Read the site's DECLARED pages (robots.txt → sitemap.xml) so discovery uses the
  // source of truth instead of only guessing paths. Best-effort + free (plain HTTP);
  // the menu/HH pages that hide from raw-HTML anchors on JS sites (Wix /about-3-1) are
  // listed here. Only worth it on a live, non-parked page.
  let sitemapUrls: string[] = [];
  if (outcome.kind === "response" && outcome.status === 200 && !isParkedHtml(outcome.html)) {
    let origin: string | null = null;
    try {
      origin = new URL(outcome.finalUrl).origin;
    } catch {
      origin = null;
    }
    if (origin) {
      const fetchText: TextFetcher = async (u) => {
        const r = await fetchHtml(u, 10000);
        return r.kind === "response" && r.status === 200 ? r.html : null;
      };
      sitemapUrls = await discoverSitemapUrls(origin, fetchText, {
        maxSitemaps: 4,
        maxUrls: 80,
      }).catch(() => []);
    }
  }

  return siteVerdictFromFetch(cls.url!, outcome, sitemapUrls);
}
