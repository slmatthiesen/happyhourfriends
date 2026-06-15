/**
 * Own-site happy-hour page probe — the $0 first step of the auto-promote pipeline.
 *
 * Given a venue's own website, GET the HH-specific subset of GUESS_MENU_PATHS on its own
 * origin and classify what we find. The verdict is persisted on the venue and drives the
 * promote orchestrator (re-extract), enrich URL-priority, and the manual-entry queue.
 *
 * Plain HTTP only (no API, no cost). MAIN-THREAD ONLY: background subagents can't web-fetch
 * (env constraint). The fetcher is injected so the unit test is hermetic.
 */
import { hasHhOrDealSignal } from "@/lib/places/hhText";
import { isNonOwnSiteHost } from "@/lib/recover/sourceProvenance";

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

/**
 * Probe the venue's own origin for a happy-hour page. Returns the FIRST `readable` page
 * (200 + HH text signal); if none is readable but at least one path is `blocked`
 * (403 / anti-bot), returns that (the real extractor escalates to headless render);
 * otherwise `none`. Never throws — a fetch error on one path is treated as a miss.
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
  for (const path of OWN_SITE_HH_PATHS) {
    const url = origin + path;
    let res: { status: number; body: string };
    try {
      res = await fetcher(url);
    } catch {
      continue; // network error on this path → treat as miss, keep probing
    }
    if (res.status === 200 && hasHhOrDealSignal(res.body)) {
      return { hhPageUrl: url, status: "readable" }; // signal beats everything — return now
    }
    if ((res.status === 403 || res.status === 401 || res.status === 429) && !blockedUrl) {
      blockedUrl = url; // remember the first wall, but keep looking for a readable page
    }
  }
  return blockedUrl ? { hhPageUrl: blockedUrl, status: "blocked" } : { hhPageUrl: null, status: "none" };
}
