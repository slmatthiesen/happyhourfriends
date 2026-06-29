/**
 * Build a single-MultiPolygon boundary GeoJSON by merging several OSM admin relations.
 * Used for aggregate cities (five-cities, silicon-valley) where one HHF "city" spans
 * multiple municipalities. Output shape matches what seed:discover expects: a
 * FeatureCollection whose FIRST (only) feature is a MultiPolygon covering every relation
 * (the loader reads features[0] only — separate features would be silently dropped).
 *
 *   tsx scripts/build-aggregate-boundary.ts --slug silicon-valley \
 *     --relations 1544955,1544956,112145,2221647,2221709,1545000,1552032
 */
import { writeFileSync } from "node:fs";
import osmtogeojson from "osmtogeojson";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

const slug = arg("slug");
const relationIds = arg("relations")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRelationGeometry(id: string): Promise<number[][][][]> {
  const query = `[out:json][timeout:90];rel(${id});out geom;`;
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
  if (!res || !res.ok) throw new Error(`Overpass ${res?.status} for relation ${id}`);
  const osm = await res.json();
  const gj = osmtogeojson(osm) as {
    features: Array<{ geometry: { type: string; coordinates: unknown } | null }>;
  };
  const polys = gj.features.filter(
    (f) =>
      f.geometry &&
      (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
  );
  if (polys.length === 0) throw new Error(`no polygon geometry for relation ${id}`);
  // Flatten every Polygon/MultiPolygon into MultiPolygon members ([rings][]).
  const members: number[][][][] = [];
  for (const f of polys) {
    const g = f.geometry!;
    if (g.type === "Polygon") members.push(g.coordinates as number[][][]);
    else for (const m of g.coordinates as number[][][][]) members.push(m);
  }
  return members;
}

async function main(): Promise<void> {
  const allMembers: number[][][][] = [];
  for (const id of relationIds) {
    const members = await fetchRelationGeometry(id);
    console.log(`relation ${id}: ${members.length} polygon part(s)`);
    allMembers.push(...members);
    await sleep(2000); // be polite to the public Overpass endpoint
  }

  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { slug, relations: relationIds },
        geometry: { type: "MultiPolygon", coordinates: allMembers },
      },
    ],
  };
  const out = `data/${slug}-boundary.geojson`;
  writeFileSync(out, JSON.stringify(fc));
  console.log(
    `✓ wrote ${out} — ${allMembers.length} total polygon part(s) from ${relationIds.length} relation(s)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
