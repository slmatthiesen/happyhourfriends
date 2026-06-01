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

export type SiteKind = "real" | "social_only" | "none";
export type Reachability = "ok" | "dead" | "parked";

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

export function isParkedHtml(html: string, _finalUrl: string): boolean {
  const lower = html.toLowerCase();
  if (PARKED_MARKERS.some((m) => lower.includes(m))) return true;
  // Near-empty body (strip tags) → placeholder shell.
  const text = lower.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length < 80;
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

async function fetchHtml(url: string, ms = 5000): Promise<{ status: number; html: string; finalUrl: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" },
    });
    const html = await res.text();
    return { status: res.status, html, finalUrl: res.url || url };
  } catch {
    return null; // DNS fail / refused / timeout / abort
  } finally {
    clearTimeout(timer);
  }
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

  const resp = await fetchHtml(cls.url!);
  if (!resp || resp.status >= 500 || (resp.status >= 404 && resp.status <= 410)) {
    return { kind: "real", url: cls.url, reachability: "dead", hhSignalUrls: [], decision: "kill", reason: `dead site (${resp ? resp.status : "unreachable"})` };
  }
  if (resp.status === 200 && isParkedHtml(resp.html, resp.finalUrl)) {
    return { kind: "real", url: cls.url, reachability: "parked", hhSignalUrls: [], decision: "kill", reason: "parked domain" };
  }
  // Reachable (incl. 403 bot-block) → extract; collect HH-signal links from the HTML we have.
  const hhSignalUrls = resp.status === 200 ? extractHhSignalLinks(resp.html, resp.finalUrl) : [];
  return { kind: "real", url: cls.url, reachability: "ok", hhSignalUrls, decision: "extract", reason: "reachable" };
}
