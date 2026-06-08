export interface AddressComponent {
  longText: string;
  shortText?: string;
  types: string[];
}

const JUNK = new Set(["parking lot", "parking", "unnamed road"]);

export function normalizeName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Pick a clean vernacular neighborhood name from Google addressComponents, or null.
 * Prefers type `neighborhood`, then `sublocality`/`sublocality_level_1`. Rejects the
 * city name itself and an obvious-junk denylist. */
export function pickNeighborhood(
  components: AddressComponent[] | null | undefined,
  cityName: string,
): string | null {
  if (!components?.length) return null;
  const byType = (t: string) => components.find((c) => c.types?.includes(t));
  const c = byType("neighborhood") ?? byType("sublocality") ?? byType("sublocality_level_1");
  if (!c?.longText) return null;
  const name = normalizeName(c.longText);
  if (!name) return null;
  const lc = name.toLowerCase();
  if (lc === cityName.trim().toLowerCase()) return null;
  if (JUNK.has(lc)) return null;
  return name;
}
