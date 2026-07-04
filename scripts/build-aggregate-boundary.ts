/**
 * Build a single-MultiPolygon boundary GeoJSON by merging several OSM admin/census
 * boundaries. Used for aggregate cities (five-cities, silicon-valley, santa-cruz)
 * where one HHF "city" spans multiple municipalities / unincorporated CDPs. Output
 * shape matches what seed:discover expects: a FeatureCollection whose FIRST (only)
 * feature is a MultiPolygon covering every input (the loader reads features[0] only —
 * separate features would be silently dropped).
 *
 * Each ref may be prefixed `r:` (relation, the default) or `w:` (way). The way form
 * is needed because some Census CDPs exist in OSM only as standalone closed ways with
 * no relation wrapper (e.g. Live Oak and Rio del Mar, CA — both `boundary=census` ways).
 *
 *   tsx scripts/build-aggregate-boundary.ts --slug silicon-valley \
 *     --relations 1544955,1544956,112145,2221647,2221709,1545000,1552032
 *   tsx scripts/build-aggregate-boundary.ts --slug santa-cruz \
 *     --relations r:111737,r:3574370,r:7063032,r:9408781,r:9408782,w:33167234,w:33167250
 */
import { writeFileSync } from "node:fs";
import osmtogeojson from "osmtogeojson";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

const slug = arg("slug");
const refs = arg("relations")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBoundaryGeometry(ref: string): Promise<number[][][][]> {
  const isWay = ref.startsWith("w:");
  const id = ref.replace(/^[wr]:/, "");
  const query = `[out:json][timeout:90];${isWay ? "way" : "rel"}(${id});out geom;`;
  // Overpass rate-limits rapid sequential calls (429); retry with backoff.
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "happyhourfriends-boundary-build/1.0 (steven.matthiesen@gmail.com)",
      },
    });
    if (res.status !== 429 && res.status !== 504) break;
    await sleep(5000 * (attempt + 1));
  }
  if (!res || !res.ok) throw new Error(`Overpass ${res?.status} for ${ref}`);
  const osm = await res.json();
  const gj = osmtogeojson(osm) as {
    features: Array<{ geometry: { type: string; coordinates: unknown } | null }>;
  };
  const polys = gj.features.filter(
    (f) =>
      f.geometry &&
      (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
  );
  if (polys.length === 0)
    throw new Error(
      `no polygon geometry for ${ref} (got ${gj.features.map((f) => f.geometry?.type).join(",") || "none"} — not a closed area?)`,
    );
  // Flatten every Polygon/MultiPolygon into MultiPolygon members ([rings][]).
  // GeoJSON + PostGIS/GEOS require each ring closed (first point === last). osmtogeojson
  // usually closes ring 0 but occasionally leaves a ring open when the OSM source has a
  // gap; close defensively so ST_Buffer/ST_Difference don't reject the boundary downstream.
  const closeRing = (ring: number[][]): number[][] =>
    ring.length >= 2 && ring[0] !== ring[ring.length - 1]
      ? [...ring, ring[0]]
      : ring;
  const members: number[][][][] = [];
  for (const f of polys) {
    const g = f.geometry!;
    if (g.type === "Polygon")
      members.push((g.coordinates as number[][][]).map(closeRing));
    else
      for (const m of g.coordinates as number[][][][])
        members.push(m.map(closeRing));
  }
  return members;
}

async function main(): Promise<void> {
  const allMembers: number[][][][] = [];
  for (const ref of refs) {
    const members = await fetchBoundaryGeometry(ref);
    console.log(`${ref}: ${members.length} polygon part(s)`);
    allMembers.push(...members);
    await sleep(2000); // be polite to the public Overpass endpoint
  }

  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { slug, relations: refs },
        geometry: { type: "MultiPolygon", coordinates: allMembers },
      },
    ],
  };
  const out = `data/${slug}-boundary.geojson`;
  writeFileSync(out, JSON.stringify(fc));
  console.log(
    `✓ wrote ${out} — ${allMembers.length} total polygon part(s) from ${refs.length} input(s)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
