/**
 * sourceDenylist — competitor happy-hour listing sites we refuse to source from.
 * Pure, no I/O. Single source of truth shared by the AI extractor (§13 first-party
 * guard) and operator tooling (e.g. the stub ranker's "where to check" hint).
 *
 * Scope is DELIBERATELY narrow: only sites whose business IS aggregating happy
 * hours (i.e. direct competitors). General listings like Yelp / OpenTable /
 * TripAdvisor / local food blogs are NOT blocked — the AI often parses better
 * HH data from them than from a venue's PDF menu, and dropping them silently
 * costs real data (2026-05-28 Blue Hound incident: 9 offerings lost to a Yelp block).
 */
export const SOURCE_DENYLIST = [
  "ultimatehappyhours",
  "seattletravel",
  "happyhourdealfinder",
  "happyhour.com",
  "happyhours.com",
  "restaurantji",
  "sirved",
  "singleplatform",
];

export function isDenylistedSource(url: string): boolean {
  let host = url.toLowerCase();
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* not a parseable URL — fall back to substring check below */
  }
  return SOURCE_DENYLIST.some((d) => host.includes(d));
}
