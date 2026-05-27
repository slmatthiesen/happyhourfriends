import type { Sql } from "postgres";

/**
 * Assign venues to a neighborhood by point-in-polygon (PRD §3 — venues.neighborhood_id
 * is derived, not stored by hand). For each venue with coordinates we pick the
 * neighborhood polygon that contains it, preferring the most specific match: a child
 * (vernacular area nested under a council district) over its parent, then the smallest
 * polygon by area.
 *
 * Idempotent and safe to re-run: only venues whose computed neighborhood differs from
 * what's stored are updated. Returns the number of rows changed. Until venues are
 * geocoded (lat/lng populated by seed:enrich / Google Places), this is a no-op — which
 * is why the seeded editorial venues currently show a blank Neighborhood column.
 *
 * Requires PostGIS (ST_Contains / ST_MakePoint / ST_Area).
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
       AND ST_Contains(
             n.polygon,
             ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)
           )
      WHERE vv.lat IS NOT NULL
        AND vv.lng IS NOT NULL
        AND vv.deleted_at IS NULL
        ${cityId ? sql`AND vv.city_id = ${cityId}` : sql``}
      ORDER BY vv.id,
               (n.parent_id IS NOT NULL) DESC,
               ST_Area(n.polygon::geography) ASC
    ) sub
    WHERE v.id = sub.vid
      AND v.neighborhood_id IS DISTINCT FROM sub.nid
    RETURNING v.id
  `;
  return rows.length;
}
