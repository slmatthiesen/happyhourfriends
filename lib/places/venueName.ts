/**
 * Strip promotional cruft that owners stuff into their Google business name — "(open for all
 * World Cup games)", "(Award-Winning Street Food)", "(#1 Mandarin Style)" — so it never leaks
 * into the venue title. Applied at discovery (fresh venues land clean) and retroactively by
 * scripts/backfill-venue-names.ts.
 *
 * CONSERVATIVE by design: only a parenthetical/bracketed group whose contents match a promo
 * signal is removed. Legitimate parentheticals are LEFT ALONE — branch/location disambiguators
 * ("(Divisadero)", "(SF Mission)", "(Shea Blvd.)"), rename context ("(formerly Souvanny's)"),
 * and service tags ("(Halal)", "(Takeout & Catering)"). Collapsing those would merge distinct
 * chain locations into identical-looking rows, which is worse than the cruft. Only bracketed
 * groups are touched — mid-name marketing text is left alone to avoid mangling real names.
 */

// Marketing signals that mark a parenthetical as promo, not a real name qualifier.
const PROMO_SIGNAL =
  /(?:\bopen\s+for\b|\bnow\s+open\b|\bgrand\s+(?:re-?)?opening\b|\bcoming\s+soon\b|\bnewly\s+opened\b|\baward[-\s]?winning\b|\bvoted\b|\bbest\b|#\s*1\b|\bno\.?\s*1\b|\bworld[-\s]?famous\b|\bworld\s*cup\b|\bsuper\s*bowl\b|\bgame\s*day\b|\bwatch\s*part(?:y|ies)\b|\bmust[-\s]?try\b|\blimited[-\s]?time\b|%\s*off\b|\bunder\s+new\s+management\b)/i;

export function stripPromoName(rawName: string): string {
  const stripped = rawName.replace(/[([][^()[\]]*[)\]]/g, (group) =>
    PROMO_SIGNAL.test(group.slice(1, -1)) ? "" : group,
  );
  if (stripped === rawName) return rawName;
  // Tidy the seam the removal left: collapse doubled spaces, drop a space before punctuation,
  // and trim trailing separators. Never return an empty string — fall back to the original.
  const cleaned = stripped
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[\s\-–—|]+$/g, "")
    .trim();
  return cleaned || rawName.trim();
}
