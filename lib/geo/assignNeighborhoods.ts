import type { Sql } from "postgres";

/**
 * Snap distance (meters): a venue not contained by any polygon is still assigned to
 * the nearest polygon within this radius. Handles polygon-precision gaps (a venue on
 * a pier just past a shoreline-clipped district), small annexed/adjacent locales
 * absorbed into the city (e.g. Ruston inside Tacoma), and GIS rounding at boundaries.
 * 100m is a conservative default that won't grab venues in genuinely different towns
 * (cross-river / cross-bridge venues are usually km away, not meters).
 */
const SNAP_METERS = 100;

/**
 * Assign venues to a neighborhood by spatial match (PRD §3 — venues.neighborhood_id is
 * derived, not stored by hand). For each venue with coordinates we pick the best
 * neighborhood polygon within SNAP_METERS, ranked:
 *   1. Containing polygon wins (ST_Distance = 0).
 *   2. Tie-break: child (vernacular nested under district) over parent.
 *   3. Tie-break: smallest polygon by area.
 * If no polygon contains the venue, the nearest one within SNAP_METERS is used as a
 * fallback (snap). Outside that radius, neighborhood_id stays NULL.
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
