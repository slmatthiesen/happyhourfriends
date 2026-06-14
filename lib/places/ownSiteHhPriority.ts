/**
 * prioritizeOwnSiteHh — put a venue's OWN happy-hour page at the front of the extractor's
 * priority URL list so it's fetched first. The first-party page then wins the window's
 * source_url and the provenance gate (PR #146) never hides it as an aggregator source.
 * Pure + exported for unit testing.
 */
export function prioritizeOwnSiteHh(priorityUrls: string[], hhPageUrl: string | null | undefined): string[] {
  if (!hhPageUrl) return priorityUrls;
  return [hhPageUrl, ...priorityUrls.filter((u) => u !== hhPageUrl)];
}
