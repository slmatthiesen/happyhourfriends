/**
 * test-supersede-bare-window — guards supersedeBareLocationDuplicates (lib/recover/
 * resolveVenue). Needs the local docker Postgres; NOT in the hermetic CI suite. Run:
 *
 *   pnpm tsx scripts/test-supersede-bare-window.ts
 *
 * The bug it locks down: a re-extraction that pins a window to a specific area ('bar')
 * doesn't match the older location-agnostic ('all') row on the natural key, so the persist
 * upsert INSERTs a second row, leaving a bare 'all' window next to the one carrying the
 * deals (Santo Mezcal: two identical Mon–Thu 2–5 windows). The helper soft-deletes the
 * redundant bare 'all' window — and ONLY that. Everything runs in a transaction that is
 * rolled back, so the local DB is left untouched.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { supersedeBareWindowsForVenue } from "@/lib/recover/resolveVenue";

class Rollback extends Error {}

async function main() {
  await db
    .transaction(async (tx) => {
      const [{ id: cityId }] = await tx.execute<{ id: string }>(sql`
        INSERT INTO cities (slug, name, state, country, default_timezone, currency_code, status)
        VALUES ('supersede-test', 'Supersede Test', 'wa', 'US', 'America/Los_Angeles', 'USD', 'live')
        RETURNING id`);
      const [{ id: venueId }] = await tx.execute<{ id: string }>(sql`
        INSERT INTO venues (city_id, name, slug, status)
        VALUES (${cityId}, 'Test Venue', 'test-venue', 'active') RETURNING id`);

      // Insert a happy_hours row and return its id.
      const win = async (loc: string, days: string, start: string, end: string) => {
        const [{ id }] = await tx.execute<{ id: string }>(sql`
          INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time, location_within_venue, active)
          VALUES (${venueId}, ${sql.raw(days)}::smallint[], ${start}::time, ${end}::time, ${loc}, true)
          RETURNING id`);
        return id as string;
      };
      const offer = async (hhId: string, name: string) => {
        await tx.execute(sql`
          INSERT INTO offerings (happy_hour_id, kind, category, name, price_cents, active)
          VALUES (${hhId}, 'drink', 'beer', ${name}, 500, true)`);
      };

      // Scenario A — the bug: bare 'all' + priced 'bar' at the SAME time. The bare 'all'
      // must be superseded.
      const bareAll = await win("all", "ARRAY[1,2,3,4]", "14:00", "17:00");
      const barDeals = await win("bar", "ARRAY[1,2,3,4]", "14:00", "17:00");
      await offer(barDeals, "Bar margarita");

      // Scenario B — legit coexistence: two DISTINCT specific areas, both priced, same time.
      // Neither may be touched.
      const patioDeals = await win("patio", "ARRAY[5]", "16:00", "18:00");
      await offer(patioDeals, "Patio wine");
      const diningDeals = await win("dining", "ARRAY[5]", "16:00", "18:00");
      await offer(diningDeals, "Dining cocktail");

      // Scenario C — a bare 'all' with NO priced same-time sibling. Must be left for review.
      // (Day 6 / 09:00–11:00 — no other scenario's deal window touches it.)
      const lonelyBare = await win("all", "ARRAY[6]", "09:00", "11:00");

      // Scenario D — cross-day coverage (LOCAL): a bare all-week window fully covered by two
      // day-split deal windows on days 1–7 must be superseded. (Isolated to 19:00–20:00 so it
      // can't interact with the afternoon scenarios above.)
      const bareAllWeek = await win("all", "ARRAY[1,2,3,4,5,6,7]", "19:00", "20:00");
      const dealEarly = await win("all", "ARRAY[1,2,3]", "19:00", "20:00");
      await offer(dealEarly, "Mon-Wed beer");
      const dealLate = await win("all", "ARRAY[4,5,6,7]", "19:00", "21:00");
      await offer(dealLate, "Thu-Sun wine");

      await supersedeBareWindowsForVenue(tx, venueId);

      const isActive = async (id: string) => {
        const [r] = await tx.execute<{ active: boolean; deleted: boolean }>(sql`
          SELECT active, deleted_at IS NOT NULL AS deleted FROM happy_hours WHERE id = ${id}`);
        return r.active && !r.deleted;
      };

      assert.equal(await isActive(bareAll), false, "bare 'all' window must be superseded");
      assert.equal(await isActive(barDeals), true, "priced 'bar' window must survive");
      assert.equal(await isActive(patioDeals), true, "distinct priced 'patio' window must survive");
      assert.equal(await isActive(diningDeals), true, "distinct priced 'dining' window must survive");
      assert.equal(await isActive(lonelyBare), true, "bare window with no priced sibling must survive");
      assert.equal(await isActive(bareAllWeek), false, "fully-covered cross-day bare window must be superseded");
      assert.equal(await isActive(dealEarly), true, "Mon-Wed deal window must survive");
      assert.equal(await isActive(dealLate), true, "Thu-Sun deal window must survive");

      console.log("✅ supersede-bare-window: bug class collapsed, cross-day coverage + coexistence + lonely bare preserved.");
      throw new Rollback();
    })
    .catch((err) => {
      if (err instanceof Rollback) return;
      throw err;
    });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
