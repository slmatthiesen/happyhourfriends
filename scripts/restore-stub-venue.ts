/**
 * restore-stub-venue — re-create a venue that was purged (hard-deleted) back to a
 * help-wanted stub, using its FIRST-PARTY Google data still held in seed_candidates.
 *
 * Why this exists: cleanup:stubs soft-deletes (and a later sweep may hard-purge) any
 * no-HH stub whose type/name carries no alcohol signal AND whose own site is dead
 * (expired_cert / unreachable / …). Google keeps the venue's old URL indexed for a
 * while, so searchers land on the "Past last call" 404. When the venue is real and
 * open (OPERATIONAL) but we simply have no first-party HH data, the right outcome is
 * a public stub that crowdsources the happy hour — not a dead page. This script
 * restores that stub from the cached Google candidate (no Places API call, $0).
 *
 * It mirrors scripts/seed-enrich-candidates.ts insertVenueRow exactly (same columns,
 * same slug-candidate + ON CONFLICT google_place_id logic, same deriveVenueType), so
 * the restored row is byte-for-byte what enrich would have produced landing a stub.
 * Stickiness is verified up front: classifyStub must return "keep" (else the next
 * cleanup:stubs sweep would re-delete it — alcohol signal is the lever).
 *
 *   Dry-run (default, no writes):
 *     pnpm tsx scripts/restore-stub-venue.ts --city scottsdale --state AZ --google-place-id ChIJ...
 *   Apply:
 *     pnpm tsx scripts/restore-stub-venue.ts --city scottsdale --state AZ --google-place-id ChIJ... --apply
 *   Resolve by name instead of place_id (prints the candidate it matched; disambiguate with place_id):
 *     pnpm tsx scripts/restore-stub-venue.ts --city scottsdale --state AZ --name "Ernie's"
 *
 * Requires DATABASE_URL only. Idempotent: a no-op if a live venue with the place_id already exists.
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { classifyStub } from "@/lib/places/stubCleanup";
import { deriveVenueType } from "@/lib/places/venueType";
import { slugify, placeIdSuffix } from "@/lib/places/venueSlug";

interface Candidate {
  id: string;
  name: string;
  google_place_id: string | null;
  address: string | null;
  lat: string | null;
  lng: string | null;
  primary_type: string | null;
  types: string[] | null;
  website_url: string | null;
  phone: string | null;
  price_level: number | null;
  hours_json: unknown;
  google_neighborhood: string | null;
  serves_alcohol: boolean | null;
  business_status: string | null;
  resulting_venue_id: string | null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const cityArgs = requireCityArgs(); // exits with usage if --city/--state missing

  const placeIdIdx = args.indexOf("--google-place-id");
  const placeId = placeIdIdx !== -1 ? args[placeIdIdx + 1] : null;
  const nameIdx = args.indexOf("--name");
  const name = nameIdx !== -1 ? args[nameIdx + 1] : null;
  if (!placeId && !name) {
    console.error("ERROR: pass --google-place-id <id> (preferred) or --name <substring>.");
    process.exit(1);
  }

  const sql = postgres(dbUrl, { prepare: false });

  const city = await resolveCity(sql, cityArgs.slug, cityArgs.state); // throws on miss/ambiguity
  const cityId = city.id;

  // Load the first-party candidate. Prefer place_id (exact, canonical); fall back to name.
  const candidates = placeId
    ? await sql<Candidate[]>`
        SELECT id, name, google_place_id, address, lat, lng, primary_type, types, website_url,
               phone, price_level, hours_json, google_neighborhood, serves_alcohol, business_status,
               resulting_venue_id
        FROM seed_candidates WHERE city_id = ${cityId} AND google_place_id = ${placeId}
      `
    : await sql<Candidate[]>`
        SELECT id, name, google_place_id, address, lat, lng, primary_type, types, website_url,
               phone, price_level, hours_json, google_neighborhood, serves_alcohol, business_status,
               resulting_venue_id
        FROM seed_candidates WHERE city_id = ${cityId} AND name ILIKE ${"%" + name + "%"}
      `;
  if (candidates.length === 0) {
    console.error(`ERROR: no seed_candidate in ${city.name} matching ${placeId ? `place_id=${placeId}` : `name=${name}`}.`);
    console.error("       Restore needs cached Google data; re-discover the city or add a candidate first.");
    process.exit(1);
  }
  if (candidates.length > 1 && !placeId) {
    console.error(`ERROR: name "${name}" matched ${candidates.length} candidates — disambiguate with --google-place-id:`);
    for (const c of candidates) console.error(`  ${c.google_place_id}  ${c.name}  (${c.address})`);
    process.exit(1);
  }
  const c = candidates[0];

  if (!c.google_place_id) {
    console.error(`ERROR: candidate ${c.name} has no google_place_id (canonical dedup key) — cannot restore.`);
    process.exit(1);
  }

  // Idempotency / safety: if a live venue already holds this place_id, there's nothing to restore.
  const existing = await sql<{ id: string; deleted_at: string | null }[]>`
    SELECT id, deleted_at FROM venues WHERE google_place_id = ${c.google_place_id}
  `;
  if (existing.length > 0) {
    const e = existing[0];
    if (e.deleted_at) {
      console.error(`ERROR: a SOFT-DELETED venue already holds place_id ${c.google_place_id} (id=${e.id}, deleted_at=${e.deleted_at}).`);
      console.error("       Un-soft-delete that row (clear deleted_at, set status='active') instead of inserting a new one.");
    } else {
      console.log(`Venue already live for place_id ${c.google_place_id} (id=${e.id}) — nothing to restore.`);
    }
    process.exit(0);
  }

  // Stickiness gate: classify what cleanup:stubs would do to this stub. Only restore if it'd KEEP.
  const verdict = classifyStub(
    {
      name: c.name,
      primaryType: c.primary_type,
      types: c.types,
      websiteUrl: c.website_url,
      siteHealth: null, // never (re-)probed → conservative "alive"
    },
    "alcohol-or-site",
  );
  const venueType = deriveVenueType({
    primaryType: c.primary_type,
    types: c.types,
    name: c.name,
  });

  console.log(`City:        ${city.name}, ${city.state}`);
  console.log(`Candidate:   ${c.name}  (${c.address})`);
  console.log(`place_id:    ${c.google_place_id}`);
  console.log(`Google type: primary=${c.primary_type ?? "—"}  serves_alcohol=${c.serves_alcohol}  status=${c.business_status}`);
  console.log(`Derived type: ${venueType}`);
  console.log(`cleanup:stubs verdict (alcohol-or-site): ${verdict.action.toUpperCase()} — ${verdict.reason}`);
  if (verdict.action === "delete") {
    console.error("\nREFUSING: classifyStub says DELETE — a restore would be re-deleted by the next cleanup:stubs sweep.");
    console.error("         The venue needs an alcohol signal (type/name) to stick as a stub. Fix the candidate first.");
    process.exit(1);
  }
  if (verdict.action === "hide") {
    console.warn("\nWARNING: classifyStub says HIDE — the stub would land as status='no_happy_hour' (not publicly listed).");
    console.warn("         It will still resolve the URL (no 404). Proceeding as a visible 'active' stub per restore intent.");
  }

  // Slug candidates mirror insertVenueRow: base, place_id-suffixed, then numbered.
  const baseSlug = slugify(c.name);
  const suffix = placeIdSuffix(c.google_place_id);
  const slugCandidates = [baseSlug, `${baseSlug}-${suffix}`, `${baseSlug}-${suffix}-2`, `${baseSlug}-${suffix}-3`];

  console.log(`\nslugs tried: ${slugCandidates.join(", ")}`);
  console.log(`\n${apply ? "APPLY" : "DRY-RUN"} (pass --apply to write)`);

  if (!apply) {
    console.log(`\nWould INSERT venues stub: name=${c.name}, type=${venueType}, status=active, data_completeness=stub`);
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    let venueId: string | null = null;
    for (let i = 0; i < slugCandidates.length; i++) {
      try {
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO venues
            (city_id, name, slug, address, lat, lng, google_place_id,
             website_url, phone, price_level, hours_json, google_neighborhood, type, status, data_completeness, last_verified_at)
          VALUES
            (${cityId}, ${c.name}, ${slugCandidates[i]}, ${c.address}, ${c.lat}, ${c.lng}, ${c.google_place_id},
             ${c.website_url}, ${c.phone}, ${c.price_level}, ${tx.json((c.hours_json ?? null) as never)}, ${c.google_neighborhood},
             ${venueType}::venue_type, 'active'::venue_status, 'stub'::data_completeness, NULL)
          ON CONFLICT (google_place_id) DO NOTHING
          RETURNING id
        `;
        venueId = inserted[0]?.id ?? null;
        break; // inserted, or absorbed by ON CONFLICT — either way stop trying slugs
      } catch (err) {
        const isSlugDup =
          typeof err === "object" && err !== null && (err as { code?: string }).code === "23505" &&
          String((err as { constraint_name?: string }).constraint_name ?? "").includes("slug");
        if (isSlugDup && i < slugCandidates.length - 1) continue;
        throw err;
      }
    }
    if (!venueId) {
      // ON CONFLICT absorbed a row that appeared between our pre-check and the insert.
      console.error("No row inserted — a venue with this google_place_id now exists. Aborting (no writes).");
      throw new Error("race: venue appeared mid-insert");
    }

    // Relink the candidate so enrich/reextract see this venue going forward.
    await tx`UPDATE seed_candidates SET resulting_venue_id = ${venueId}, updated_at = now() WHERE id = ${c.id}`;

    // Paper trail — restore of deliberately-purged data deserves an audit entry (mirrors cleanup-stubs).
    await tx`
      INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
      VALUES (
        'venues', ${venueId}, NULL,
        ${tx.json({ restored_from_seed_candidate: c.id, google_place_id: c.google_place_id, type: venueType, status: "active", data_completeness: "stub" })},
        'admin:restore-stub-venue',
        ${"restored purged venue to help-wanted stub from first-party seed_candidate (search traffic hitting dead URL)"}
      )
    `;
    console.log(`\n✓ restored venue id=${venueId}`);
  });

  // Assign neighborhood for the whole city (idempotent point-in-polygon; cheap, places the new venue).
  const { assignNeighborhoods } = await import("@/lib/geo/assignNeighborhoods");
  const assigned = await assignNeighborhoods(sql, cityId);
  console.log(`✓ neighborhood assignment: ${assigned} venue(s) updated in ${city.name}`);

  await sql.end();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
