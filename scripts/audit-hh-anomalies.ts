/**
 * audit-hh-anomalies — READ-ONLY scan for "odd looking" happy-hour windows.
 *
 * Surfaces the day/time mistakes the extractor occasionally makes (e.g. mis-grouping
 * "Wednesday thru Friday" into an all-day bucket). All checks are heuristics for human
 * review, not auto-fixes — a flag means "eyeball the source", not "wrong".
 *
 * Usage:
 *   tsx scripts/audit-hh-anomalies.ts                 # scan every live venue
 *   tsx scripts/audit-hh-anomalies.ts --city Scottsdale --state AZ
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const args = process.argv.slice(2);
  const city = valueFor(args, "--city");
  const state = valueFor(args, "--state");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const scope = city && state ? sql`AND c.name = ${city} AND c.state = ${state}` : sql``;

  try {
    // A. Chain divergence: same venue name, different window signatures across locations.
    //    Chain happy hours are almost always identical; a mismatch is the strongest smell
    //    (this is exactly what set the correct Ajo Al's twin apart from the garbled one).
    const chains = await sql`
      WITH sig AS (
        SELECT v.name,
               string_agg(
                 (CASE WHEN hh.all_day THEN 'ALLDAY'
                       ELSE coalesce(hh.start_time::text,'?') || '-' || coalesce(hh.end_time::text,'close') END)
                 || '@' || array_to_string(hh.days_of_week, ','),
                 ' | ' ORDER BY hh.days_of_week, hh.start_time
               ) AS window_sig,
               min(c.name) AS city
        FROM venues v
        JOIN cities c ON c.id = v.city_id
        JOIN happy_hours hh ON hh.venue_id = v.id AND hh.active
        WHERE v.status = 'active' ${scope}
        GROUP BY v.id, v.name
      )
      SELECT name, count(*) AS locations, count(DISTINCT window_sig) AS distinct_sigs,
             array_agg(city || ' => ' || window_sig ORDER BY city) AS signatures
      FROM sig
      GROUP BY name
      HAVING count(*) >= 2 AND count(DISTINCT window_sig) > 1
      ORDER BY count(DISTINCT window_sig) DESC, count(*) DESC`;

    // B. Mixed cadence: one venue with BOTH all-day and time-boxed windows. Legitimate
    //    sometimes, but it's how the Ajo mis-group looked (Wed landed in the all-day set).
    const mixed = await sql`
      SELECT v.name, c.name AS city, c.state,
             array_agg(DISTINCT array_to_string(hh.days_of_week, ',')) FILTER (WHERE hh.all_day) AS all_day_on,
             array_agg(DISTINCT array_to_string(hh.days_of_week, ',')) FILTER (WHERE NOT hh.all_day) AS timed_on
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      JOIN happy_hours hh ON hh.venue_id = v.id AND hh.active
      WHERE v.status = 'active' ${scope}
      GROUP BY v.id, v.name, c.name, c.state
      HAVING bool_or(hh.all_day) AND bool_or(NOT hh.all_day)
      ORDER BY c.name, v.name`;

    // C. Implausible times: end<=start without crosses_midnight, span >6h, or pre-6am start.
    const times = await sql`
      SELECT v.name, c.name AS city, c.state, hh.days_of_week,
             hh.start_time, hh.end_time, hh.crosses_midnight
      FROM happy_hours hh
      JOIN venues v ON v.id = hh.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE hh.active AND v.status = 'active' AND NOT hh.all_day AND hh.start_time IS NOT NULL ${scope}
        AND (
          (hh.end_time IS NOT NULL AND hh.end_time <= hh.start_time AND NOT coalesce(hh.crosses_midnight, false))
          OR (hh.end_time IS NOT NULL AND (hh.end_time - hh.start_time) > interval '6 hours')
          OR hh.start_time < time '06:00'
        )
      ORDER BY c.name, v.name`;

    section("A. Chain divergence (same name, different windows)", chains);
    section("B. Mixed all-day + timed windows on one venue", mixed);
    section("C. Implausible times (end<=start / span>6h / pre-6am)", times);
  } finally {
    await sql.end();
  }
}

function valueFor(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function section(title: string, rows: readonly unknown[]) {
  console.log(`\n=== ${title} — ${rows.length} ===`);
  if (rows.length) console.dir(rows, { depth: null, maxArrayLength: null });
}

main().catch((e) => { console.error(e); process.exit(1); });
