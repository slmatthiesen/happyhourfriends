/**
 * Pure point-in-polygon (ray casting) for GeoJSON Polygon / MultiPolygon geometries.
 *
 * Used by seed:discover to drop candidates that fall inside ANOTHER already-onboarded
 * city's municipal boundary — the geographic half of crossover defense (the structural
 * half is the global-unique google_place_id). Mailing-address city is unreliable at
 * borders, so polygon containment is the authority (Berkeley/Oakland lesson, 2026-06-18).
 *
 * Kept dependency-free and in-process (no PostGIS round-trip per candidate) so it's cheap
 * to test every candidate against every sibling boundary, and hermetically unit-testable.
 */
export type Position = [number, number];
type LinearRing = Position[];

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: LinearRing[];
}
export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: LinearRing[][];
}
export type PolygonLike = PolygonGeometry | MultiPolygonGeometry;

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Even-odd ray cast: is the point inside this single linear ring? */
function pointInRing(pt: Position, ring: LinearRing): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring AND not inside any hole, for one polygon (ring[0] = outer). */
function pointInSinglePolygon(pt: Position, rings: LinearRing[]): boolean {
  if (rings.length === 0 || !pointInRing(pt, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(pt, rings[h])) return false; // in a hole
  }
  return true;
}

/** True when the point is inside a Polygon or any part of a MultiPolygon. */
export function pointInPolygon(pt: Position, geom: PolygonLike): boolean {
  if (geom.type === "Polygon") return pointInSinglePolygon(pt, geom.coordinates);
  return geom.coordinates.some((poly) => pointInSinglePolygon(pt, poly));
}

/** Axis-aligned bounding box — a cheap reject before the full ray cast. */
export function bboxOf(geom: PolygonLike): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as Position;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(c)) {
      for (const child of c) walk(child);
    }
  };
  walk(geom.coordinates);
  return { minX, minY, maxX, maxY };
}

export function inBBox(pt: Position, b: BBox): boolean {
  return pt[0] >= b.minX && pt[0] <= b.maxX && pt[1] >= b.minY && pt[1] <= b.maxY;
}

/**
 * Normalize a GeoJSON file's top level (Feature / FeatureCollection / bare geometry) to a
 * Polygon|MultiPolygon geometry. Mirrors the boundary-load logic in seed:discover.
 */
export function geometryFromGeoJson(raw: {
  type: string;
  features?: { geometry: PolygonLike }[];
  geometry?: PolygonLike;
  coordinates?: unknown;
}): PolygonLike {
  if (raw.type === "FeatureCollection") return raw.features![0].geometry;
  if (raw.type === "Feature") return raw.geometry!;
  return raw as unknown as PolygonLike;
}
