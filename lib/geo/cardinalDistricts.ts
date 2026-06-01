/**
 * Generated cardinal-district geometry. Produces a deterministic, GAP-FREE partition of a
 * city's bounding box into 5 broad rectangles — North/South span the full width (top/bottom
 * third), West/East are the middle row's left/right cells, Central is the middle cell. The
 * generator (scripts/generate-cardinal-districts.ts) intersects each with the real city
 * boundary and adds a Downtown buffer on top, so the bland generic names only ever appear
 * where no recognizable named or admin coarse area covers a venue.
 *
 * Generic labels by default; an optional per-city alias map renames individual zones
 * (e.g. Tucson Central → Midtown). Pure function — unit-tested, no I/O.
 */

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type CardinalZone = "North" | "South" | "West" | "East" | "Central";

/** Optional per-city override: generic zone → display name. */
export type CardinalAliases = Partial<Record<CardinalZone, string>>;

export interface CardinalRect {
  /** Display name (aliased if an override was supplied). */
  name: string;
  /** The generic zone this rect represents (stable; used for slugs/aliasing). */
  zone: CardinalZone;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
}

function rect(
  west: number,
  south: number,
  east: number,
  north: number,
): { type: "Polygon"; coordinates: [number, number][][] } {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/**
 * Partition `bbox` into the 5 cardinal rectangles. Thirds are computed linearly in lng/lat.
 * North = top third full width, South = bottom third full width, West/East = middle row
 * left/right cells, Central = middle cell.
 */
export function cardinalRects(bbox: Bbox, aliases: CardinalAliases = {}): CardinalRect[] {
  const { west, south, east, north } = bbox;
  const dx = (east - west) / 3;
  const dy = (north - south) / 3;
  const x1 = west + dx;
  const x2 = west + 2 * dx;
  const y1 = south + dy;
  const y2 = south + 2 * dy;

  const zones: { zone: CardinalZone; geom: ReturnType<typeof rect> }[] = [
    { zone: "South", geom: rect(west, south, east, y1) },
    { zone: "West", geom: rect(west, y1, x1, y2) },
    { zone: "Central", geom: rect(x1, y1, x2, y2) },
    { zone: "East", geom: rect(x2, y1, east, y2) },
    { zone: "North", geom: rect(west, y2, east, north) },
  ];

  return zones.map(({ zone, geom }) => ({
    zone,
    name: aliases[zone] ?? zone,
    geometry: geom,
  }));
}
