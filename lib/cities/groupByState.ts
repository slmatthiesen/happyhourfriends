import type { CityListItem } from "@/lib/queries/venues";
import { stateName } from "@/lib/geo/usStates";

export interface StateGroup {
  /** Raw state code as stored (e.g. "CA"); "" for cities with no state. */
  code: string;
  /** Display name (e.g. "California"); falls back to the code, then "Other". */
  name: string;
  cities: CityListItem[];
}

/**
 * Group cities by state for the landing-page picker. States are ordered
 * alphabetically by display name; cities keep their incoming order within a group
 * (the query already sorts by name). Cities with an unknown/empty state code fall
 * into a trailing "Other" group so none are dropped.
 */
export function groupCitiesByState(cities: CityListItem[]): StateGroup[] {
  const byCode = new Map<string, StateGroup>();

  for (const city of cities) {
    const code = (city.state ?? "").trim();
    let group = byCode.get(code);
    if (!group) {
      group = { code, name: code ? stateName(code) : "Other", cities: [] };
      byCode.set(code, group);
    }
    group.cities.push(city);
  }

  return [...byCode.values()].sort((a, b) => {
    // "Other" (codeless) always sorts last, regardless of name.
    if (!a.code !== !b.code) return a.code ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
