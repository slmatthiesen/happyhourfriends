/**
 * Own-site happy-hour page probe — the $0 first step of the auto-promote pipeline.
 *
 * Given a venue's own website, decide whether it has a reachable happy-hour page worth
 * re-extracting. Two passes (plain HTTP, no API):
 *   1. GET the HH-specific guessed paths (/happy-hour, /specials, …) on the venue's origin.
 *   2. If none hit, fetch the homepage and DISCOVER HH pages the site LINKS or DECLARES
 *      (anchor links + Wix `pageUriSEO` routes) — this catches non-guessed paths AND JS-SPA
 *      sites whose HH page exists as a declared route even though the raw HTML carries no HH
 *      text (the Wix/Squarespace recall gap, [[js-walled-sites-and-pdf-menus]]).
 * The verdict drives the promote orchestrator (re-extract), enrich URL-priority, and the
 * manual-entry queue.
 *
 * MAIN-THREAD ONLY: background subagents can't web-fetch (env constraint). The fetcher is
 * injected so the unit test is hermetic.
 */
import { hasHhOrDealSignal, scoreHhUrl } from "@/lib/places/hhText";
import { extractHhSignalLinks, extractPageRoutes, pickDeclaredPages } from "@/lib/places/siteTriage";
import { isNonOwnSiteHost } from "@/lib/recover/sourceProvenance";

/** scoreHhUrl threshold for "HH-specific" (matches the audit's render-escalation bar): explicit
 *  happy-hour pages (100+), specials (70), drink/cocktail menus (60). Generic /menu (30-40) is
 *  not specific enough to count as a discovered HH page on its own. */
const HH_URL_SCORE = 60;

/** The HH-specific paths from siteTriage.GUESS_MENU_PATHS — most→least specific. A real HH
 *  page lives at one of these; /menu and /drinks are deliberately excluded (too generic to
 *  count as a happy-hour page on their own). */
export const OWN_SITE_HH_PATHS = [
  "/happy-hour",
  "/happyhour",
  "/happy-hour-menu",
  "/menu/happy-hour",
  "/specials",
];

export type ProbeStatus = "readable" | "blocked" | "none";
export interface ProbeResult {
  hhPageUrl: string | null;
  status: ProbeStatus;
}

export type Fetcher = (url: string) => Promise<{ status: number; body: string }>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; HappyHourFriends/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  // Only read the body for non-error responses we'll actually inspect.
  const body = res.ok ? await res.text() : "";
  return { status: res.status, body };
};

const isBotWall = (status: number) => status === 403 || status === 401 || status === 429 || status === 406;

/** Read one candidate URL: `readable` if 200 + HH signal, otherwise note if it's a bot-wall. */
async function tryReadHh(
  url: string,
  fetcher: Fetcher,
): Promise<"readable" | "blocked" | "miss"> {
  let res: { status: number; body: string };
  try {
    res = await fetcher(url);
  } catch {
    return "miss"; // network error → treat as a miss, keep probing
  }
  if (res.status === 200 && hasHhOrDealSignal(res.body)) return "readable";
  if (isBotWall(res.status)) return "blocked";
  return "miss";
}

/**
 * Probe the venue's own origin for a happy-hour page (see file header for the two passes).
 * Returns `readable` (a page we read HH text from — re-extract works cheaply), `blocked` (an HH
 * page that exists but plain HTTP can't read — 403/anti-bot OR a JS-walled declared route — so
 * re-extract must escalate to headless render), or `none`. Never throws.
 */
export async function probeOwnSiteHhPage(
  websiteUrl: string | null | undefined,
  fetcher: Fetcher = defaultFetcher,
): Promise<ProbeResult> {
  let origin: string;
  try {
    origin = new URL(websiteUrl!).origin;
  } catch {
    return { hhPageUrl: null, status: "none" };
  }
  // The "website" on file is sometimes a social profile or a parent-hotel/booking domain, not
  // a site the venue controls a /happy-hour route on — probing those yields a meaningless
  // generic page (instagram.com/happy-hour, www3.hilton.com/happy-hour). Skip them.
  if (isNonOwnSiteHost(origin)) return { hhPageUrl: null, status: "none" };

  let blockedUrl: string | null = null;
  const note = (url: string, verdict: "readable" | "blocked" | "miss"): ProbeResult | null => {
    if (verdict === "readable") return { hhPageUrl: url, status: "readable" };
    if (verdict === "blocked" && !blockedUrl) blockedUrl = url;
    return null;
  };

  // Pass 1: guessed HH-specific paths.
  for (const path of OWN_SITE_HH_PATHS) {
    const hit = note(origin + path, await tryReadHh(origin + path, fetcher));
    if (hit) return hit;
  }

  // Pass 2: discover HH pages the homepage LINKS or DECLARES (catches non-guessed paths and
  // JS-SPA Wix routes the guessed-path check can't read).
  let home: { status: number; body: string };
  try {
    home = await fetcher(origin);
  } catch {
    home = { status: 0, body: "" };
  }
  if (home.status === 200 && home.body) {
    const declared = pickDeclaredPages(
      [...extractHhSignalLinks(home.body, origin), ...extractPageRoutes(home.body, origin)],
      origin,
      8,
    ).filter((u) => scoreHhUrl(u) >= HH_URL_SCORE && !isNonOwnSiteHost(u));
    for (const url of declared.slice(0, 3)) {
      const hit = note(url, await tryReadHh(url, fetcher));
      if (hit) return hit;
    }
    // A declared HH route we found but could NOT plain-read (JS-walled content) is still a real
    // HH page — route it to render-based re-extract rather than dropping it as `none`.
    if (declared.length && !blockedUrl) blockedUrl = declared[0];
  } else if (isBotWall(home.status) && !blockedUrl) {
    blockedUrl = origin; // the whole site bot-walls plain fetch → re-extract with render
  }

  return blockedUrl ? { hhPageUrl: blockedUrl, status: "blocked" } : { hhPageUrl: null, status: "none" };
}
