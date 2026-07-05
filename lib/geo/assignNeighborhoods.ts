import type { Sql } from "postgres";
import { RECOGNIZABLE_BAR } from "@/lib/geo/recognizability";
import {
  planNameClusters,
  canonicalNeighborhoodKey,
  type DistrictRow,
  type PlannedCluster,
} from "@/lib/geo/neighborhoodCanonical";
import { neighborhoodOverridesFor } from "@/lib/geo/neighborhoodOverrides";

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
 * Critical mass for a neighborhood label (operator rule 2026-05: a lone-venue neighborhood
 * isn't a useful label or filter). Shared by two enforcement points that MUST agree:
 *   - the UI, which suppresses below-threshold neighborhoods (lib/queries/venues.ts), and
 *   - stage 0 here, where a venue's Google neighborhood name only wins over polygon
 *     assignment when at least this many venues in the city share the name (summed across
 *     spelling variants of the same canonical name). A lone micro-name ("Motel District")
 *     would create a neighborhood the UI hides — leaving the venue rendering blank despite
 *     being assigned — so it falls through to polygons instead.
 */
export const MIN_VENUES_PER_NEIGHBORHOOD = 2;

/**
 * An inferred synonym merge ("Camelback East Village" → coarse "Camelback East",
 * "Downtown Oakland" → "Downtown") only fires when at least this fraction of the
 * cluster's geocoded venues actually sit inside (within SNAP_METERS of) the target
 * district polygon. The gate is what keeps name-only lookalikes apart: Tucson's
 * "Catalina Village" (a Campbell Ave shopping area) name-matches the coarse "Catalina"
 * CDP 15 miles north — 0% containment, no merge, it stays its own area.
 */
const SYNONYM_CONTAINMENT_MIN = 0.8;

export interface CityRef {
  id: string;
  name: string;
  slug: string;
  state: string;
}

/** A planned cluster enriched with the containment-gate result for synonym candidates. */
export interface GatedCluster extends PlannedCluster {
  /** Fraction of geocoded venues within the synonym target polygon (synonym clusters only). */
  containment?: number;
  /** True when the cluster will NOT get its own row (synonym confirmed or curated merge). */
  mergesAway: boolean;
}

/**
 * Build the stage-0 plan for one city: cluster the city's Google neighborhood names by
 * canonical key (spelling variants fold together), propose synonym/curated merges, and
 * run the containment gate on inferred synonyms. Pure read.
 */
export async function planCityNeighborhoods(sql: Sql, city: CityRef): Promise<GatedCluster[]> {
  const googleNames = await sql<{ name: string; venues: number }[]>`
    SELECT google_neighborhood AS name, count(*)::int AS venues
    FROM venues
    WHERE city_id = ${city.id} AND deleted_at IS NULL AND google_neighborhood IS NOT NULL
    GROUP BY 1
  `;
  const districts = await sql<DistrictRow[]>`
    SELECT id, name, slug, tier, (polygon IS NOT NULL) AS "hasPolygon", source
    FROM neighborhoods
    WHERE city_id = ${city.id}
  `;
  const clusters = planNameClusters({
    cityName: city.name,
    minVenues: MIN_VENUES_PER_NEIGHBORHOOD,
    googleNames,
    districts,
    overrides: neighborhoodOverridesFor(city.state, city.slug),
  });

  const gated: GatedCluster[] = [];
  for (const c of clusters) {
    if (c.curatedInto) {
      gated.push({ ...c, mergesAway: true });
      continue;
    }
    if (c.synonymOf) {
      // An EXACT-name match (the "South Scottsdale" rule) always falls through to the
      // polygon stages, regardless of containment: it can't relabel anything (the name
      // already IS the district's), a containing fine polygon should still win, and a
      // same-slug row of our own is impossible anyway. The containment gate below only
      // guards AFFIX synonyms (trailing "Village", city-name token), where a false
      // merge would visibly relabel venues (Catalina Village → Catalina).
      const exact = canonicalNeighborhoodKey(c.synonymOf.name) === c.key;
      const [{ frac }] = await sql<{ frac: number | null }[]>`
        SELECT (count(*) FILTER (WHERE ST_DWithin(
                 n.polygon::geography,
                 ST_SetSRID(ST_MakePoint(v.lng::float8, v.lat::float8), 4326)::geography,
                 ${SNAP_METERS})))::float / NULLIF(count(*), 0) AS frac
        FROM venues v, neighborhoods n
        WHERE n.id = ${c.synonymOf.id}
          AND v.city_id = ${city.id}
          AND v.deleted_at IS NULL
          AND v.lat IS NOT NULL AND v.lng IS NOT NULL
          AND v.google_neighborhood = ANY(${c.names})
      `;
      const containment = frac ?? 0;
      gated.push({
        ...c,
        containment,
        mergesAway: exact || containment >= SYNONYM_CONTAINMENT_MIN,
      });
      continue;
    }
    gated.push({ ...c, mergesAway: false });
  }
  return gated;
}

/** Same slug shape the legacy SQL produced: runs of non-alphanumerics → '-'. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Find or create the neighborhood row a cluster's venues should point at. Reuses the
 * planner's attachTo row when present; a polygon-less Google row is renamed to the
 * cluster's display name (so a curated "St. Philip's Plaza" replaces the misspelled
 * variant) unless the target slug is already taken by another row. Imported rows
 * (GIS/OSM, or anything with a polygon) are never renamed.
 */
async function ensureClusterRow(sql: Sql, cityId: string, c: PlannedCluster): Promise<string> {
  const slug = slugify(c.displayName);
  if (c.attachTo) {
    if (
      !c.attachTo.hasPolygon &&
      c.attachTo.source === "Google Places" &&
      c.attachTo.name !== c.displayName
    ) {
      await sql`
        UPDATE neighborhoods SET name = ${c.displayName}, slug = ${slug}
        WHERE id = ${c.attachTo.id}
          AND NOT EXISTS (
            SELECT 1 FROM neighborhoods
            WHERE city_id = ${cityId} AND slug = ${slug} AND id <> ${c.attachTo.id}
          )
      `;
    }
    return c.attachTo.id;
  }
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO neighborhoods (city_id, name, slug, polygon, source, tier, recognizability, is_fallback, in_scope)
    VALUES (${cityId}, ${c.displayName}, ${slug}, NULL, 'Google Places', 'fine', ${RECOGNIZABLE_BAR}::smallint, false, true)
    ON CONFLICT (city_id, slug) DO NOTHING
    RETURNING id
  `;
  if (inserted.length) return inserted[0].id;
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM neighborhoods WHERE city_id = ${cityId} AND slug = ${slug}
  `;
  return existing.id;
}

/**
 * Assign venues to a neighborhood (PRD §3 — venues.neighborhood_id is derived, not stored
 * by hand). Runs per city (all cities when cityId is null).
 *
 * Stage 0 — name-primary, canonical: the city's Google neighborhood names are clustered
 * by canonicalNeighborhoodKey (case/punctuation/abbreviation/diacritic-insensitive, plus
 * a levenshtein-1 fold), so spelling variants of one area share one row and critical mass
 * is judged on the cluster total. A cluster that is a synonym of a coarse polygon
 * district — exact match (the "South Scottsdale" rule), trailing "Village" ("Camelback
 * East Village"), or a city-name affix ("Downtown Oakland") — and whose venues actually
 * sit inside that polygon (SYNONYM_CONTAINMENT_MIN) gets NO row of its own: its venues
 * fall through to the polygon stages, where a containing recognizable fine beats the
 * coarse district, exactly as for venues without a Google name. Curated merges
 * (lib/geo/neighborhoodOverrides.ts) assign straight to the target district row.
 *
 * Everyone else gets a spatial match: we pick the best neighborhood polygon within
 * SNAP_METERS, ranked:
 *   1. Eligible candidates first: a recognizable fine neighborhood (tier='fine' AND
 *      recognizability >= RECOGNIZABLE_BAR), OR any coarse district. A fine neighborhood
 *      below the recognizability bar is ineligible (shadowed) and only wins when no
 *      eligible polygon is in range.
 *   2. Containing polygon (ST_Distance = 0) beats merely-near. SNAP_METERS is a
 *      polygon-precision tolerance, not a "near enough to count" radius — a coarse
 *      district that fully contains a venue must beat a recognizable fine the venue is
 *      only within snap range of but NOT inside.
 *   3. Among polygons at the same distance: recognizable fine beats coarse. (A
 *      containing fine still wins over a containing coarse because they tie at
 *      distance 0 and key 3 breaks toward fine.)
 *   4. Higher recognizability wins.
 *   5. Tie-break: smallest polygon by area.
 * Outside SNAP_METERS, neighborhood_id stays NULL (until stage 2's unambiguous wide snap).
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
  const cities = await sql<CityRef[]>`
    SELECT id, name, slug, state FROM cities
    ${cityId ? sql`WHERE id = ${cityId}` : sql``}
    ORDER BY slug
  `;
  let changed = 0;
  for (const city of cities) changed += await assignCity(sql, city);
  return changed;
}

async function assignCity(sql: Sql, city: CityRef): Promise<number> {
  const plan = await planCityNeighborhoods(sql, city);

  // Stage 0 — apply the plan. ownedNames = google names stage 0 assigns directly; the
  // polygon stages must leave those venues alone. Confirmed-synonym names are NOT owned:
  // their venues go through polygon assignment (a containing fine may beat the district).
  const ownedNames: string[] = [];
  let changed = 0;
  for (const c of plan) {
    let rowId: string | null = null;
    if (c.curatedInto) {
      rowId = c.curatedInto.id;
    } else if (!c.mergesAway) {
      rowId = await ensureClusterRow(sql, city.id, c);
    } else {
      continue; // confirmed synonym → polygon stages
    }
    ownedNames.push(...c.names);
    const rows = await sql<{ id: string }[]>`
      UPDATE venues v
      SET neighborhood_id = ${rowId}, updated_at = now()
      WHERE v.city_id = ${city.id}
        AND v.deleted_at IS NULL
        AND v.google_neighborhood = ANY(${c.names})
        AND v.neighborhood_id IS DISTINCT FROM ${rowId}
      RETURNING v.id
    `;
    changed += rows.length;
  }

  // Polygon stages skip every venue stage 0 owns; everyone else — no google name, a
  // below-critical-mass one, or a confirmed synonym of a district — gets spatial matching.
  const notOwned =
    ownedNames.length > 0
      ? sql`AND (vv.google_neighborhood IS NULL OR vv.google_neighborhood <> ALL(${ownedNames}))`
      : sql``;

  // Stage 1 — tight snap, ranked (see the function doc for the full ranking rationale).
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
        AND vv.city_id = ${city.id}
        ${notOwned}
      ORDER BY vv.id,
               -- 1. Eligible candidates first: a recognizable fine neighborhood, OR any
               --    coarse district. A fine neighborhood below the recognizability bar is
               --    ineligible (shadowed) and only used as a last resort.
               (CASE WHEN n.tier = 'fine' AND n.recognizability < ${RECOGNIZABLE_BAR}
                     THEN 1 ELSE 0 END) ASC,
               -- 2. Containing polygon (distance 0) beats merely-near. The snap radius is a
               --    precision tolerance, not a "near enough to count" radius — a coarse
               --    district that fully contains a venue beats a recognizable fine that
               --    the venue is only within 100m of but NOT inside.
               ST_Distance(
                 n.polygon::geography,
                 ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)::geography
               ) ASC,
               -- 3. Among polygons at the same distance: prefer a recognizable FINE name
               --    over a COARSE rollup. A containing fine (distance 0) still wins over
               --    a containing coarse because they tie at key 2 and this key breaks it.
               (CASE WHEN n.tier = 'fine' THEN 0 ELSE 1 END) ASC,
               -- 4. Higher recognizability wins.
               n.recognizability DESC,
               -- 5. Tie-break: smaller (more specific) polygon.
               ST_Area(n.polygon::geography) ASC
    ) sub
    WHERE v.id = sub.vid
      AND v.neighborhood_id IS DISTINCT FROM sub.nid
    RETURNING v.id
  `;

  // Stage 2 — unambiguous "closeness" fill for venues the tight snap left NULL. Assign the
  // nearest neighborhood within WIDE_SNAP_METERS only when it's a clear winner (no second
  // neighborhood at a comparable distance). Ambiguous venues stay NULL by design.
  // NOTE: stage 2 does NOT apply the stage-1 recognizability eligibility filter — a lone
  // obscure fine (recognizability 0) within 1mi can win here. Acceptable: stage 2 only fires
  // for venues contained by NOTHING within 100m (a polygonless fringe), where the sole nearby
  // polygon is the best available label regardless of recognizability.
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
          AND vv.city_id = ${city.id}
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

  // Tidy: drop polygon-less Google-name rows no venue points at anymore — orphaned
  // spelling-variant rows after a canonical fold, names that lost critical mass, or
  // pre-gate micro-name rows. They're invisible in the UI but would accumulate forever.
  // Recreated by stage 0 if the name ever reaches critical mass again.
  await sql`
    DELETE FROM neighborhoods n
    WHERE n.source = 'Google Places'
      AND n.polygon IS NULL
      AND n.city_id = ${city.id}
      AND NOT EXISTS (SELECT 1 FROM venues v WHERE v.neighborhood_id = n.id)
      AND NOT EXISTS (SELECT 1 FROM neighborhoods ch WHERE ch.parent_id = n.id)
  `;

  return changed + rows.length + wide.length;
}

export { canonicalNeighborhoodKey };
