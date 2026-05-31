import type { Sql } from "postgres";

/**
 * Snap distance (meters): a venue not contained by any polygon is still assigned to the
 * nearest polygon within this radius. Handles polygon-precision gaps (a venue on a pier
 * just past a shoreline-clipped district), small annexed/adjacent locales absorbed into
 * the city, and GIS rounding at boundaries. Kept SMALL on purpose: a large radius would
 * mislabel a venue with a neighborhood it isn't actually in ("nearest" 1–2 km away is the
 * wrong descriptor). The lever for coverage is ADDING neighborhood polygons for under-mapped
 * areas, NOT widening this snap. Venues beyond this radius from any polygon stay NULL.
 */
const SNAP_METERS = 100;

/**
 * Assign venues to a neighborhood by spatial match (PRD §3 — venues.neighborhood_id is
 * derived, not stored by hand). For each venue with coordinates we pick the best
 * neighborhood polygon within SNAP_METERS, ranked:
 *   1. Non-fallback polygon beats a fallback one (is_fallback ASC) — a primary neighborhood
 *      within snap range wins over an overlapping fallback/gap-fill (e.g. Zillow) polygon.
 *   2. Containing polygon wins (ST_Distance = 0), else nearest within SNAP_METERS.
 *   3. Tie-break: child (vernacular nested under district) over parent.
 *   4. Tie-break: smallest polygon by area.
 * Outside SNAP_METERS, neighborhood_id stays NULL.
 *
 * Idempotent and safe to re-run: only venues whose computed neighborhood differs from
 * what's stored are updated. Returns the number of rows changed. Until venues are
 * geocoded (lat/lng populated by seed:enrich / Google Places), this is a no-op.
 *
 * Requires PostGIS (ST_DWithin / ST_Distance / ST_MakePoint / ST_Area).
 */
export async function assignNeighborhoods(
  sql: Sql,
  cityId?: string | null,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE venues v
    SET neighborhood_id = sub.nid,
        updated_at = now()
    FROM (
      SELECT DISTINCT ON (vv.id) vv.id AS vid, n.id AS nid
      FROM venues vv
      JOIN neighborhoods n
        ON n.city_id = vv.city_id
       AND n.polygon IS NOT NULL
       AND ST_DWithin(
             n.polygon::geography,
             ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)::geography,
             ${SNAP_METERS}
           )
      WHERE vv.lat IS NOT NULL
        AND vv.lng IS NOT NULL
        AND vv.deleted_at IS NULL
        ${cityId ? sql`AND vv.city_id = ${cityId}` : sql``}
      ORDER BY vv.id,
               n.is_fallback ASC,
               ST_Distance(
                 n.polygon::geography,
                 ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)::geography
               ) ASC,
               (n.parent_id IS NOT NULL) DESC,
               ST_Area(n.polygon::geography) ASC
    ) sub
    WHERE v.id = sub.vid
      AND v.neighborhood_id IS DISTINCT FROM sub.nid
    RETURNING v.id
  `;
  return rows.length;
}
