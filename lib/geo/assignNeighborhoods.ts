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
 * Wide "closeness" assignment (stage 2): a venue still unassigned after the tight snap is
 * given its NEAREST neighborhood up to this radius — but ONLY when that nearest is an
 * unambiguous winner (no conflict). If a second neighborhood is comparably close, we leave
 * it NULL rather than guess wrong. This is self-protecting by density: in a sparse fringe a
 * venue has one obvious nearby neighborhood (assign it); in a dense city it has several
 * within a mile (ambiguous → stay blank, and it's usually contained anyway). 1 mile is the
 * operator-stated ceiling for an unambiguous assignment.
 */
const WIDE_SNAP_METERS = 1609; // 1 mile
// "No conflict": the nearest neighborhood is clearly closest — the 2nd-nearest is at least
// 2x its distance OR at least this many meters farther. Otherwise it's a tie → no assignment.
const AMBIGUITY_GAP_METERS = 500;

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

  // Stage 2 — unambiguous "closeness" fill for venues the tight snap left NULL. Assign the
  // nearest neighborhood within WIDE_SNAP_METERS only when it's a clear winner (no second
  // neighborhood at a comparable distance). Ambiguous venues stay NULL by design.
  const wide = await sql<{ id: string }[]>`
    UPDATE venues v
    SET neighborhood_id = sub.nid,
        updated_at = now()
    FROM (
      SELECT t.vid, t.nid
      FROM (
        SELECT vv.id AS vid,
               (array_agg(d.nid ORDER BY d.dist))[1] AS nid,
               (array_agg(d.dist ORDER BY d.dist))[1] AS d1,
               (array_agg(d.dist ORDER BY d.dist))[2] AS d2
        FROM venues vv
        JOIN LATERAL (
          SELECT n.id AS nid,
                 ST_Distance(
                   n.polygon::geography,
                   ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)::geography
                 ) AS dist
          FROM neighborhoods n
          WHERE n.city_id = vv.city_id
            AND n.polygon IS NOT NULL
            AND ST_DWithin(
                  n.polygon::geography,
                  ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)::geography,
                  ${WIDE_SNAP_METERS}
                )
        ) d ON true
        WHERE vv.lat IS NOT NULL
          AND vv.lng IS NOT NULL
          AND vv.deleted_at IS NULL
          AND vv.neighborhood_id IS NULL
          ${cityId ? sql`AND vv.city_id = ${cityId}` : sql``}
        GROUP BY vv.id
      ) t
      -- unambiguous: only one neighborhood within range, or the nearest clearly beats the next
      WHERE t.d2 IS NULL
         OR t.d2 >= t.d1 * 2
         OR t.d2 - t.d1 >= ${AMBIGUITY_GAP_METERS}
    ) sub
    WHERE v.id = sub.vid
      AND v.neighborhood_id IS NULL
    RETURNING v.id
  `;

  return rows.length + wide.length;
}
