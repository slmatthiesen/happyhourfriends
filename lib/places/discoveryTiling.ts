/**
 * Adaptive density-aware tiling for seed discovery.
 *
 * Google Places (New) `searchNearby` returns at most 20 results per call. Under the
 * default POPULARITY ranking those are the 20 most prominent venues in the circle —
 * so lower-profile bars in dense areas are silently dropped. We switch the caller to
 * rankPreference=DISTANCE (nearest 20) and, when a tile still comes back saturated
 * (exactly 20 = the API truncated), subdivide it into 4 smaller tiles and re-query —
 * recursively, down to a floor — so coverage is complete and self-tunes to density.
 *
 * This module is PURE + injectable: `collectAdaptive` takes a `fetchTile` function so
 * it can be unit-tested with a mock (no network). The script wires the real Places
 * fetch in.
 */

/** A search circle. `depth` tracks recursion for the subdivision floor. */
export interface Tile {
  lat: number;
  lng: number;
  radiusMeters: number;
  depth: number;
}

/** Anything with a stable Google place id; used for cross-tile de-duplication. */
export interface TilePlace {
  id?: string;
}

/** Google Places per-call result cap. A tile returning this many = saturated. */
export const MAX_RESULTS = 20;
/** Subdivision floor: never query a circle smaller than this radius. */
export const MIN_RADIUS_METERS = 400;
/** Subdivision floor: never recurse deeper than this. */
export const MAX_DEPTH = 4;
/** Safety cap on total tiles processed per run (runaway-spend backstop). */
export const DEFAULT_MAX_TILES = 2000;

/**
 * Split a saturated tile into 4 quadrant children at half the radius. Child centers
 * are offset by radius/2 in each lat/lng direction so the four half-radius circles
 * cover the parent's area (with overlap — harmless, de-duped on place id).
 */
export function splitTile(tile: Tile): Tile[] {
  const childRadius = tile.radiusMeters / 2;
  const offsetM = tile.radiusMeters / 2;
  const latPerM = 1 / 111_320;
  const lngPerM = 1 / (111_320 * Math.cos((tile.lat * Math.PI) / 180));
  const dLat = offsetM * latPerM;
  const dLng = offsetM * lngPerM;
  const depth = tile.depth + 1;
  return [
    { lat: tile.lat + dLat, lng: tile.lng + dLng, radiusMeters: childRadius, depth },
    { lat: tile.lat + dLat, lng: tile.lng - dLng, radiusMeters: childRadius, depth },
    { lat: tile.lat - dLat, lng: tile.lng + dLng, radiusMeters: childRadius, depth },
    { lat: tile.lat - dLat, lng: tile.lng - dLng, radiusMeters: childRadius, depth },
  ];
}

/** True when a saturated tile is still allowed to subdivide (above the floor). */
function canSubdivide(tile: Tile): boolean {
  return tile.depth < MAX_DEPTH && tile.radiusMeters / 2 >= MIN_RADIUS_METERS;
}

export interface CollectAdaptiveOptions<T extends TilePlace> {
  seedTiles: Tile[];
  /** Fetch all places for one tile (≤ maxResults). Injected so tests need no network. */
  fetchTile: (tile: Tile) => Promise<T[]>;
  maxResults?: number;
  maxTiles?: number;
  /** Called when a saturated tile cannot subdivide (genuine dense hotspot at the floor). */
  onFloorSaturated?: (tile: Tile) => void;
}

/**
 * Process seed tiles, subdividing saturated ones, until every tile returns < maxResults
 * (or hits the floor). Returns a Map keyed on place id (cross-tile de-dup). Throws if the
 * tile count exceeds maxTiles so a bug can't silently burn Places quota.
 */
export async function collectAdaptive<T extends TilePlace>(
  opts: CollectAdaptiveOptions<T>,
): Promise<Map<string, T>> {
  const maxResults = opts.maxResults ?? MAX_RESULTS;
  const maxTiles = opts.maxTiles ?? DEFAULT_MAX_TILES;
  const collected = new Map<string, T>();
  const queue: Tile[] = [...opts.seedTiles];
  let processed = 0;

  while (queue.length > 0) {
    const tile = queue.shift() as Tile;
    processed++;
    if (processed > maxTiles) {
      throw new Error(
        `Adaptive tiling exceeded ${maxTiles} tiles — aborting to avoid runaway Places spend.`,
      );
    }
    const results = await opts.fetchTile(tile);
    for (const r of results) {
      if (r.id) collected.set(r.id, r);
    }
    if (results.length >= maxResults) {
      if (canSubdivide(tile)) {
        queue.push(...splitTile(tile));
      } else {
        opts.onFloorSaturated?.(tile);
      }
    }
  }
  return collected;
}
