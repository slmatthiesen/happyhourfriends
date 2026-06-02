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
  hhSignalUrls: string[];
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

// href substrings / anchor-text patterns that signal a happy-hour or menu page.
const HH_LINK_PATTERNS = [
  /happy[-_ ]?hour/i,
  /specials?/i,
  /(beer|drink|cocktail|wine|food)[-_ ]?menu/i,
  /\/menus?\b/i,
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
    const text = m[2].replace(/<[^>]+>/g, " ");
    const hit = HH_LINK_PATTERNS.some((re) => re.test(href) || re.test(text));
    if (!hit) continue;
    try {
      out.add(new URL(href, baseUrl).toString());
    } catch {
      /* skip unresolvable href */
    }
    if (out.size >= 5) break;
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
const MEDIA_SIGNAL = /menu|happy|hour|\bbar\b|drink|cocktail|special|food|dinner|lunch|brunch/i;

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
      const u = abs(href);
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
      const u = abs(src);
      if (u) out.add(u);
    }
  }
  return [...out].slice(0, 4);
}

/** Common HH/menu paths to PROBE even when nothing links them (most→least specific). */
export const GUESS_MENU_PATHS = [
  "/happy-hour", "/happyhour", "/happy-hour-menu", "/menu/happy-hour",
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
): { action: "extract" | "stub" | "kill"; reason: string; priorityUrls: string[] } {
  // No real site on file, but the venue type is promising → "go for it":
  // let the extractor's web_search try to find the site before we give up.
  if (verdict.kind === "none" && likelihood != null && likelihood > 0.5) {
    return { action: "extract", reason: "no site on file but likely HH (>50%)", priorityUrls: [] };
  }
  return { action: verdict.decision, reason: verdict.reason, priorityUrls: verdict.hhSignalUrls };
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
export function siteVerdictFromFetch(url: string, outcome: FetchOutcome): SiteVerdict {
  if (outcome.kind === "timeout") {
    return { kind: "real", url, reachability: "timeout", hhSignalUrls: [], decision: "stub", reason: "slow site (timeout) — kept as stub" };
  }
  if (outcome.kind === "blocked") {
    return { kind: "real", url, reachability: "timeout", hhSignalUrls: [], decision: "stub", reason: "server present but unreadable (TLS/reset) — kept as stub" };
  }
  if (outcome.kind === "unreachable") {
    return { kind: "real", url, reachability: "dead", hhSignalUrls: [], decision: "kill", reason: "dead site (unreachable)" };
  }
  const { status, html, finalUrl } = outcome;
  if (status >= 500 || (status >= 404 && status <= 410)) {
    return { kind: "real", url, reachability: "dead", hhSignalUrls: [], decision: "kill", reason: `dead site (${status})` };
  }
  if (status === 200 && isParkedHtml(html)) {
    return { kind: "real", url, reachability: "parked", hhSignalUrls: [], decision: "kill", reason: "parked domain" };
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
  if (status === 200) {
    const media = extractMediaLinks(html, finalUrl); // PDF/image menus — highest value
    const links = extractHhSignalLinks(html, finalUrl);
    const routes = extractPageRoutes(html, finalUrl).filter((u) => scoreHhUrl(u) > 0);
    const confirmed = rankCandidates([...links, ...routes], 8);
    const guesses = rankCandidates(guessMenuUrls(finalUrl), 12);
    hhSignalUrls = [...new Set([...media, ...confirmed, ...guesses])].slice(0, 12);
  } else {
    hhSignalUrls = guessMenuUrls(url); // bot-blocked: still probe the obvious paths
  }
  return { kind: "real", url, reachability: "ok", hhSignalUrls, decision: "extract", reason: "reachable" };
}

export async function triageSite(input: {
  websiteUri: string | null;
  name: string;
  cityName: string | null;
}): Promise<SiteVerdict> {
  const cls = classifyUrl(input.websiteUri);
  if (cls.kind === "none") {
    return { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" };
  }
  if (cls.kind === "social_only") {
    return { kind: "social_only", url: cls.url, reachability: null, hhSignalUrls: [], decision: "stub", reason: "social/ordering link only" };
  }

  const outcome = await fetchHtml(cls.url!);
  return siteVerdictFromFetch(cls.url!, outcome);
}
