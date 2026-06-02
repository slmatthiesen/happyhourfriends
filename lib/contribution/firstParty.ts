import { isDenylistedSource } from "@/lib/ai/sourceDenylist";

/** Lowercase host with a leading "www." stripped; null if unparseable. */
function normHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * True when `submittedUrl` is on the venue's OWN website (`venueWebsite`) — the
 * self-authenticating signal that lets a contribution be trusted to auto-apply.
 * A subdomain of the site counts (menu.x.com vs x.com). A known aggregator never
 * counts, even if the domains line up. No stored website → not first-party.
 */
export function isFirstPartyUrl(
  submittedUrl: string | null | undefined,
  venueWebsite: string | null | undefined,
): boolean {
  const sub = normHost(submittedUrl);
  const site = normHost(venueWebsite);
  if (!sub || !site) return false;
  if (submittedUrl && isDenylistedSource(submittedUrl)) return false;
  return sub === site || sub.endsWith(`.${site}`);
}
