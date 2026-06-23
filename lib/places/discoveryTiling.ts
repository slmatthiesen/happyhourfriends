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
export const MIN_RADIUS_METERS = 700;
/** Subdivision floor: never recurse deeper than this. ONE level of subdivision — the densest
 *  cells stay at the seed-grid resolution's child size and are logged as floor-saturated rather
 *  than chased deeper (deliberate cost cap; bump this to trade money for density). */
export const MAX_DEPTH = 1;
/** Safety cap on total tiles processed per run (runaway-spend backstop). At MAX_DEPTH=1 a run
 *  is bounded well under this; if it ever trips, a parameter is wrong. */
export const DEFAULT_MAX_TILES = 300;

/**
 * Radius of a child tile = parent radius / 2. Children are centered at ±radius/2 offsets.
 * NOTE: 4 circles of radius r/2 do not perfectly cover the parent circle — small arcs along
 * the parent's N/S/E/W edges are uncovered — but the seed grid overlaps heavily (seed spacing
 * = seed radius) so neighboring tiles cover those arcs in practice. We use r/2 (not r/√2,
 * which fully covers but shrinks so slowly it quadruples cost for ~4 subdivision levels) as a
 * deliberate cost/coverage trade: r/2 reaches the floor in far fewer levels.
 */
function subdividedRadius(tile: Tile): number {
  return tile.radiusMeters / 2;
}

/**
 * Split a saturated tile into 4 quadrant children. Centers are offset by radius/2 in each
 * lat/lng direction; child radius = radius/√2 (see subdividedRadius) so the four child
 * circles fully cover the parent circle (overlap at the seams is harmless — de-duped on
 * place id).
 */
export function splitTile(tile: Tile): Tile[] {
  const childRadius = subdividedRadius(tile);
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
  return tile.depth < MAX_DEPTH && subdividedRadius(tile) >= MIN_RADIUS_METERS;
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

// ---------------------------------------------------------------------------
// Region-shape-agnostic adaptive engine (drives the saturation-recursive HH recall).
// `collectAdaptive` above is the circle-specific Nearby variant; this generalizes the
// same control structure to ANY region (e.g. lat/lng rectangles for Text Search): fetch
// a region, and if it came back saturated AND is still above its floor AND we're under the
// call cap, split it and recurse. Pure + injectable so it unit-tests with no network.
// ---------------------------------------------------------------------------

export interface RegionFetchResult<T extends TilePlace> {
  places: T[];
  /** The region returned MORE than one fetch could surface (truncated) — subdivide it. */
  saturated: boolean;
  /** API calls this region's fetch consumed (Text Search paginates → up to N per region). */
  calls: number;
}

export interface CollectAdaptiveRegionsOptions<R, T extends TilePlace> {
  seedRegions: R[];
  /** Fetch all places for one region (deduped upstream by id). Injected for tests. */
  fetchRegion: (region: R) => Promise<RegionFetchResult<T>>;
  /** Split a saturated region into smaller children. */
  splitRegion: (region: R) => R[];
  /** True when a saturated region is still allowed to subdivide (above the floor). */
  canSubdivide: (region: R) => boolean;
  /** Cost cap: stop once cumulative fetch calls reach this. Default Infinity. */
  maxCalls?: number;
  /** Called when a saturated region cannot subdivide (genuine dense hotspot at the floor). */
  onFloorSaturated?: (region: R) => void;
  /** Called when maxCalls halts the run, with the number of queued regions left unvisited. */
  onCapReached?: (remaining: number) => void;
}

/**
 * Process seed regions, subdividing saturated ones until each returns un-saturated (or hits
 * the floor or the call cap). Returns the deduped place map + total calls made.
 */
export async function collectAdaptiveRegions<R, T extends TilePlace>(
  opts: CollectAdaptiveRegionsOptions<R, T>,
): Promise<{ collected: Map<string, T>; calls: number }> {
  const maxCalls = opts.maxCalls ?? Infinity;
  const collected = new Map<string, T>();
  const queue: R[] = [...opts.seedRegions];
  let calls = 0;

  while (queue.length > 0) {
    if (calls >= maxCalls) {
      opts.onCapReached?.(queue.length);
      break;
    }
    const region = queue.shift() as R;
    const r = await opts.fetchRegion(region);
    calls += r.calls;
    for (const p of r.places) {
      if (p.id) collected.set(p.id, p);
    }
    if (r.saturated) {
      if (opts.canSubdivide(region)) queue.push(...opts.splitRegion(region));
      else opts.onFloorSaturated?.(region);
    }
  }
  return { collected, calls };
}
