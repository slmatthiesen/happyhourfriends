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

import { HH_RE, scoreHhUrl } from "@/lib/places/hhText";
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
 * Links the venue EXPLICITLY labels "happy hour" in their anchor text — the single strongest
 * signal a page is THE happy-hour page, regardless of its URL slug. A Wix/Squarespace site often
 * gives that page an opaque slug (Hop & Vine's "Happy Hour" nav points to /catering-zysi-RcQW),
 * so scoreHhUrl ranks it BELOW generic /menu routes and the cap drops it. These are returned
 * separately so the caller can rank them at the TOP, ahead of URL-slug ranking and decorative
 * menu-item images. Pure + exported for unit testing.
 */
export function extractHhAnchorLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, " ").trim();
    if (!/happy[-\s]?hour/i.test(text)) continue;
    try {
      out.add(new URL(m[1], baseUrl).toString());
    } catch {
      /* skip unresolvable href */
    }
    if (out.size >= 4) break;
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

// How far BEFORE a media link to look for "happy hour" page text. The HH heading sits just
// above the linked menu doc — Hula Hoops's Square JSON puts "Happy Hour Mon-Fri 3:00pm-5:30pm"
// ~200 chars before the Dinner-menu PDF link, while the Brunch PDF is preceded by "Bottomless
// Mimosa". Tight so a nearby-but-unrelated section's HH text doesn't bleed onto the wrong doc.
const HH_CONTEXT_WINDOW = 400;

/** A media (PDF/image) menu link plus whether the PAGE linked it in a happy-hour context
 *  (the anchor text / alt / nearby source said "happy hour"). hhContext is the page's OWN
 *  label for the doc — a stronger signal of which doc holds the deals than the filename, so
 *  downstream budget selection ranks hhContext docs first. (Lucky Silver's HH.pdf, filename-
 *  score 0, was demoted under DRINK-MENUS.pdf, filename-score 60, and dropped by the byte
 *  budget — because selection re-ranked by filename and discarded this flag.) */
export interface MediaLink {
  url: string;
  hhContext: boolean;
}

/**
 * Media (PDF/image) menu links in the page, RANKED so a doc that sits in a happy-hour context
 * comes first. >50% of HH menus are a document, not HTML; when a site links several (dinner,
 * brunch, catering) only the one next to the "happy hour" text holds the deals, so picking by
 * filename alone sends the wrong menu (Hula Hoops's Brunch PDF outweighed its HH Dinner PDF).
 * Each link is tagged `hhContext` when "happy hour" appears in its anchor text / alt / the
 * source just before it; context links sort first (stable within each group). Callers then
 * spend the doc budget on the HH-linked doc and skip the irrelevant ones — and downstream
 * selection keeps the flag to rank that doc above filename score (see selectDocsWithinBudget).
 */
export function extractMediaLinksDetailed(html: string, baseUrl: string): MediaLink[] {
  // url → hhContext (true if ANY occurrence sits next to happy-hour text). Insertion order
  // preserved by Map, so a stable context-first sort keeps discovery order within each group.
  const found = new Map<string, boolean>();
  const abs = (u: string) => { try { return new URL(u, baseUrl).toString(); } catch { return null; } };
  const add = (u: string | null, hhContext: boolean) => {
    if (u) found.set(u, (found.get(u) ?? false) || hhContext);
  };
  // "happy hour" in the link's own label/alt, or in the source window just before it.
  const hhNear = (src: string, index: number, extra = "") =>
    HH_RE.test(extra) || HH_RE.test(src.slice(Math.max(0, index - HH_CONTEXT_WINDOW), index));

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
      add(u, hhNear(html, m.index, text));
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
      add(u, hhNear(html, m.index, alt));
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
      add(u, hhNear(block, um.index));
    }
  }
  // Generic page-builder JSON (Square Online, Wix, Squarespace, …): the menu PDF/image URL is
  // embedded in the builder's own page-data JSON, NOT an <a>/<img>/ld+json tag the scanners
  // above can see, and often as an ESCAPED, RELATIVE path with spaces in the filename
  // (Hula Hoops/Square: "\/uploads\/…\/Hula-Hoops-Dinner Menu PDF.pdf"). Unescape, then keep
  // any quoted media path whose name carries a menu/HH signal (NOISE filter still drops
  // logos/heroes). The HH heading sits in the JSON just before the link, so context ranks it.
  const unescaped = html.replace(/\\\//g, "/");
  const QUOTED_MEDIA = /["']([^"'<>]+?\.(?:pdf|jpe?g|png|webp))(\?[^"'<>]*)?["']/gi;
  let qm: RegExpExecArray | null;
  while ((qm = QUOTED_MEDIA.exec(unescaped)) !== null) {
    const raw = (qm[1] + (qm[2] ?? "")).replace(/&amp;/gi, "&");
    if (MEDIA_NOISE.test(raw) || !MEDIA_SIGNAL.test(raw)) continue;
    const isPdf = /\.pdf(\?|$)/i.test(raw);
    const u = abs(isPdf ? raw : fullResImageUrl(raw));
    add(u, hhNear(unescaped, qm.index));
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
      add(abs(href), hhNear(html, m.index, href + " " + label));
    }
  }
  // HH-context docs first (stable within each group → discovery order preserved), capped at 6.
  return [...found.entries()]
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([url, hhContext]) => ({ url, hhContext }))
    .slice(0, 6);
}

/** Media (PDF/image) menu link URLs in the page, hhContext-first (see extractMediaLinksDetailed).
 *  The URL-only view kept for callers that don't need the per-link context flag. */
export function extractMediaLinks(html: string, baseUrl: string): string[] {
  return extractMediaLinksDetailed(html, baseUrl).map((m) => m.url);
}

// Third-party MENU-widget hosts: restaurant sites embed the actual menu (items + prices, often
// the ONLY place the happy-hour deals live) in a cross-origin iframe from one of these platforms.
// The iframe content is invisible to the page's own text AND to extractMediaLinks (which scans
// <a>/<img>/ld+json media, not <iframe>), so the window extracts but the deals don't → a bare
// window (Finch & Fork SB: SinglePlatform). These hosts are platform-wide, so fetching the widget
// URL as text recovers a whole class of venues. Allowlist (not a generic iframe sweep) so maps/
// social/video/reservation iframes — which carry no menu — are never followed. host-suffix match.
const MENU_EMBED_HOSTS = [
  "singleplatform.com", // menu-display widget (places./menus.singleplatform.com) — verified
  "toasttab.com", // Toast online ordering (order.toasttab.com) — menu + prices
  "popmenu.com", // Popmenu menu platform
  "getbento.com", // BentoBox menu embeds
];

/**
 * Menu-widget iframe URLs in `html`, absolutized + deduped (discovery order preserved). Only
 * iframes whose host is a known MENU platform (MENU_EMBED_HOSTS) — a reservation/map/social
 * iframe is never returned. Caller fetches each as a text page so the embedded deals reach the
 * model. Pure + exported for unit testing. Run on RENDERED html (the iframe is usually JS-injected).
 */
export function extractMenuEmbedUrls(html: string, baseUrl: string): string[] {
  const out = new Map<string, true>();
  const iframeRe = /<iframe\b[^>]*?\b(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = iframeRe.exec(html)) !== null) {
    // Rendered HTML encodes & as &amp; in attributes; decode so query params keep their real names
    // (else `&amp;display_menu=…` parses as a param literally named `amp;display_menu`, the widget
    // ignores menu scoping and returns EVERY menu — Finch & Fork's 260KB all-menus dump).
    const src = m[1].replace(/&amp;/gi, "&");
    let abs: URL;
    try { abs = new URL(src, baseUrl); } catch { continue; }
    const host = abs.hostname.toLowerCase();
    if (MENU_EMBED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) out.set(abs.toString(), true);
  }
  const urls = [...out.keys()];
  // A `*_modal` widget is a "browse every menu" popup — on an HH page it floods the payload with
  // regular-menu items (meal-special over-capture). Drop it WHEN a scoped sibling carries the
  // actual menu; keep it only if it's the lone widget.
  const isModal = (u: string) => /_modal\/?$/i.test(new URL(u).pathname);
  const scoped = urls.filter((u) => !isModal(u));
  return scoped.length > 0 ? scoped : urls;
}

/** Common HH/menu paths to PROBE even when nothing links them (most→least specific).
 *  When adding HH-specific paths here, check `ownSiteHhProbe.OWN_SITE_HH_PATHS` — it is a
 *  deliberate subset of these (the generic /menu, /drinks, /cocktails paths are excluded
 *  because they're too generic to count as a happy-hour page on their own). */
export const GUESS_MENU_PATHS = [
  "/happy-hour", "/happyhour", "/happy-hour-menu", "/menu/happy-hour", "/menus/happy-hour",
  "/specials", "/bar-menu", "/drink-menu", "/drinks", "/cocktails",
  "/menu", "/menus", "/food-menu",
];

// Multilingual HH pages (Iberia's was /vermut-hour/): ethnic venues label their happy hour
// in their own language (Spanish vermut/hora-feliz, Italian aperitivo). Probed ONLY for
// venues whose cuisine/name signals that locale — guessing them for an American seafood
// chain is four guaranteed 404s per venue (same-host round-trips that pressure the rate
// limiter). When a venue actually LINKS such a page, extractHhSignalLinks/routes/sitemap
// still find it regardless; this list is only the unlinked-path safety net.
export const MULTILINGUAL_MENU_PATHS = ["/vermut-hour", "/hora-feliz", "/aperitivo", "/apericena"];

// Cuisine/name signal that a venue may label its happy hour in Spanish or Italian.
const MULTILINGUAL_LOCALE_RE =
  /spanish|mexican|latin|tapas|peruvian|argentin|cuban|spaniard|italian|trattoria|osteria|enoteca|cantina|taqueria|taco|vermut|aperitivo|apericena/i;

/** True when a venue's name/types suggest a Spanish/Italian/Latin HH vocabulary. */
export function wantsMultilingualGuesses(
  signal: { name?: string | null; primaryType?: string | null; types?: string[] | null } = {},
): boolean {
  const hay = [signal.name, signal.primaryType, ...(signal.types ?? [])].filter(Boolean).join(" ");
  return MULTILINGUAL_LOCALE_RE.test(hay);
}

export function guessMenuUrls(baseUrl: string, includeMultilingual = false): string[] {
  try {
    const origin = new URL(baseUrl).origin;
    const paths = includeMultilingual ? [...GUESS_MENU_PATHS, ...MULTILINGUAL_MENU_PATHS] : GUESS_MENU_PATHS;
    return paths.map((p) => origin + p);
  } catch {
    return [];
  }
}

// Same-origin pages worth reading for HH even when the URL carries NO menu keyword.
// Wix (and similar) auto-name a venue's events/HH page with an opaque slug like
// `/about-3-1` — scoreHhUrl scores it 0, so the old `scoreHhUrl(u) > 0` filter dropped
// it and the page (which holds the HH) was never fetched. CONTENT_HINT keeps such pages;
// PAGE_NOISE + EDITORIAL_NOISE drop routes that never carry a happy hour.
//
// Deliberately EXCLUDES the bare meal/food tokens (food|dining|dinner|lunch|brunch): on
// chains they matched marketing/blog slugs (Anthony's /finn-the-food-truck,
// /our-seafood-buyers-guide, /fanzone-dining, /certified-sustainable-lobster-tail-dinners)
// that scored 0 yet were fetched AND fed to the model — wasted round-trips + input tokens.
// A real menu page still survives on `menu`; a daily-special page on `special`; the opaque
// Wix slug on `about`/`event`. So we lose the marketing noise, not the HH.
const CONTENT_HINT =
  /about|event|special|menu|drink|cocktail|happy|hour|deal|\bbar\b|vermut|aperitivo|apericena|hora[-_ ]?feliz/i;
const PAGE_NOISE =
  /\/(cart|checkout|account|login|sign-?in|register|privacy|terms|gift|careers?|jobs?|contact|reservations?|order-online|form-confirmation|sitemap)\b/i;
// Editorial/blog/PR pages that legitimately carry a HH keyword (a "cocktail-guide" article,
// a "happy-hour-news" post) but are prose, not a menu — drop them even when CONTENT_HINT or
// scoreHhUrl would otherwise keep them. Anchored so it never eats a real /menu or /specials.
const EDITORIAL_NOISE =
  /\/(blog|news|press|article|story|stories|recipes?|guide|cooking|featured)\b|\/20\d\d\/\d|food-truck/i;

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
    .filter((u) => !PAGE_NOISE.test(u) && !EDITORIAL_NOISE.test(u))
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
  wantMultilingual = false,
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
    // Links the venue itself labels "Happy Hour" — the strongest signal. They lead EVERYTHING
    // (ahead of slug-ranking and menu-item images) so an opaque-slug HH page (/catering-zysi-RcQW)
    // is never crowded out of the fetch cap by generic /menu routes.
    const hhAnchors = extractHhAnchorLinks(html, finalUrl);
    const links = extractHhSignalLinks(html, finalUrl);
    // Embedded routes (Wix pageUriSEO): keep keyword pages AND opaque content slugs
    // (/about-3-1) — not just scoreHhUrl>0, which dropped the latter.
    const routes = pickDeclaredPages(extractPageRoutes(html, finalUrl), finalUrl, 8);
    const confirmed = rankCandidates([...links, ...routes], 8);
    // Pages the site DECLARES in its sitemap — the source of truth, no guessing. These
    // rank ahead of speculative path guesses (a declared /about-3-1 / /scottsdale exists;
    // a guessed /happy-hour usually 404s).
    const declared = pickDeclaredPages(sitemapUrls, finalUrl, 6);
    // Speculative path guesses, ranked most-likely-HH first. Multilingual paths are gated
    // to Spanish/Italian/Latin venues (wantMultilingual) — guessing them everywhere is dead
    // round-trips that pressure the rate limiter. Cap 12 = MAX_FETCH; confirmed pages lead,
    // so guesses only fill the slots real pages leave.
    const guesses = rankCandidates(guessMenuUrls(finalUrl, wantMultilingual), 12);
    // CONFIRMED = linked docs + anchor/route links + sitemap pages (all known to exist).
    // EXCLUDES `guesses` — only confirmed pages may trigger a PAID escalation downstream.
    // hhAnchors lead and are NOT re-ranked (rankCandidates would demote them by slug again).
    confirmedHhUrls = [...new Set([...hhAnchors, ...rankCandidates([...rankedMedia, ...confirmed, ...declared], 12)])].slice(0, 12);
    hhSignalUrls = [...new Set([...hhAnchors, ...rankedMedia, ...confirmed, ...declared, ...guesses])].slice(0, 12);
  } else {
    hhSignalUrls = guessMenuUrls(url, wantMultilingual); // bot-blocked: still probe the obvious paths
    confirmedHhUrls = []; // page unreadable → nothing confirmed (guesses must not escalate)
  }
  return { kind: "real", url, reachability: "ok", hhSignalUrls, confirmedHhUrls, decision: "extract", reason: "reachable" };
}

export async function triageSite(input: {
  websiteUri: string | null;
  name: string;
  cityName: string | null;
  primaryType?: string | null;
  types?: string[] | null;
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

  const wantMultilingual = wantsMultilingualGuesses({
    name: input.name,
    primaryType: input.primaryType,
    types: input.types,
  });
  return siteVerdictFromFetch(cls.url!, outcome, sitemapUrls, wantMultilingual);
}
