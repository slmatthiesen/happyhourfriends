/**
 * Retroactive site triage over EXISTING stub venues (PRD §7.3 cleanup).
 *
 * For each data_completeness='stub' venue in the city:
 *   - dead / parked / no-site (low likelihood) → KILL (delete the venue) — GUARDED:
 *     only if it has no happy_hours, edit_submissions, community_flags, audit_log
 *     references, and no active promotion. If any exist, keep it and note it.
 *   - reachable + HH-signal links found → re-extract pointed at those links; with
 *     --apply, upgrade stub→complete when times now appear.
 *   - everything else (social-only, reachable-no-links, no-site-but-promising) → keep.
 *
 * Dry-run by default (report only). Pass --apply to perform deletes + upgrades.
 * Always writes docs/<city>-killed-venues.md.
 *
 * Usage: tsx scripts/triage-stub-sites.ts --city phoenix [--limit N] [--apply]
 * Env: DATABASE_URL (required), ANTHROPIC_API_KEY (only needed for --apply upgrades).
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { renderKillReport, type KillEntry, type KillReason } from "@/lib/places/killReport";
import { extractHappyHours } from "@/lib/ai/extractHappyHours";
import type { VenueType } from "@/lib/places/venueType";

function killReasonOf(reason: string): KillReason {
  if (reason.startsWith("dead")) return "dead";
  if (reason.startsWith("parked")) return "parked";
  return "no_site";
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    city: get("--city") ?? "tacoma",
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : null,
    apply: a.includes("--apply"),
  };
}

type Sql = ReturnType<typeof postgres>;

interface StubVenue {
  id: string;
  name: string;
  website_url: string | null;
  type: string | null;
  promotion_tier: string;
  neighborhood_name: string | null;
}

/**
 * Refuse to delete a stub that carries any human/community work. Real schema:
 * edit_submissions + community_flags key on (target_type='venue', target_id);
 * audit_log keys on (table_name='venues', row_id); "promotion" is a column on
 * venues (checked by the caller via promotion_tier), not a separate table.
 */
async function hasAttachments(sql: Sql, venueId: string): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`
    SELECT (
      (SELECT count(*) FROM happy_hours WHERE venue_id = ${venueId}) +
      (SELECT count(*) FROM edit_submissions WHERE target_type = 'venue' AND target_id = ${venueId}) +
      (SELECT count(*) FROM community_flags WHERE target_type = 'venue' AND target_id = ${venueId}) +
      (SELECT count(*) FROM audit_log WHERE table_name = 'venues' AND row_id = ${venueId})
    )::int AS n`;
  return (r?.n ?? 0) > 0;
}

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL not set.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 1 });
  const mode = args.apply ? "APPLY" : "DRY-RUN";

  try {
    const [city] = await sql<{ id: string; slug: string; name: string }[]>`
      SELECT id, slug, name FROM cities WHERE slug = ${args.city}`;
    if (!city) throw new Error(`City '${args.city}' not found.`);

    const stubs = await sql<StubVenue[]>`
      SELECT v.id, v.name, v.website_url, v.type::text AS type,
             v.promotion_tier::text AS promotion_tier, n.name AS neighborhood_name
      FROM venues v
      LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
      WHERE v.city_id = ${city.id} AND v.data_completeness = 'stub'
      ORDER BY v.created_at ASC
      ${args.limit != null ? sql`LIMIT ${args.limit}` : sql``}`;

    console.log(`[${mode}] triaging ${stubs.length} stub(s) for '${city.slug}'…`);
    const killEntries: KillEntry[] = [];
    let killed = 0;
    let upgraded = 0;
    let kept = 0;
    let guarded = 0;

    for (const [i, v] of stubs.entries()) {
      console.log(`[${i + 1}/${stubs.length}] ${v.name}…`);
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const likelihood = hhLikelihood({ venueType: (v.type as VenueType | null) ?? null, name: v.name });
      const decided = resolveEnrichAction(verdict, likelihood);

      if (decided.action === "kill") {
        if (v.promotion_tier !== "none" || (await hasAttachments(sql, v.id))) {
          console.log("  ↷ keep — has submissions/flags/HH/promotion/audit (not deletable)");
          guarded++;
          kept++;
          continue;
        }
        killEntries.push({
          name: v.name,
          neighborhood: v.neighborhood_name,
          reason: killReasonOf(verdict.reason),
          urlTried: verdict.url,
          likelihood,
        });
        if (args.apply) {
          await sql`DELETE FROM venues WHERE id = ${v.id}`;
          console.log(`  ✗ killed — ${decided.reason}`);
        } else {
          console.log(`  ✗ WOULD kill — ${decided.reason}`);
        }
        killed++;
        continue;
      }

      // Promising: reachable with HH-signal links → try to upgrade.
      if (decided.action === "extract" && decided.priorityUrls.length > 0) {
        if (!process.env.ANTHROPIC_API_KEY) {
          console.log("  ◦ promising (links found) but no ANTHROPIC_API_KEY — keep stub");
          kept++;
          continue;
        }
        const extracted = await extractHappyHours({
          venueName: v.name,
          websiteUrl: verdict.url,
          otherUrl: null,
          cityName: city.name,
          priorityUrls: decided.priorityUrls,
        });
        if (extracted.happyHours.length > 0) {
          if (args.apply) {
            await sql`UPDATE venues SET data_completeness = 'complete', last_verified_at = now(), updated_at = now() WHERE id = ${v.id}`;
            for (const hh of extracted.happyHours) {
              const days = [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
              const [row] = await sql<{ id: string }[]>`
                INSERT INTO happy_hours
                  (venue_id, days_of_week, all_day, start_time, end_time, location_within_venue, notes, active, source_url)
                VALUES
                  (${v.id}, ${days}, ${hh.allDay}, ${hh.startTime}, ${hh.endTime},
                   ${hh.locationWithinVenue}::location_within_venue, ${hh.notes}, true, ${hh.sourceUrl})
                ON CONFLICT DO NOTHING RETURNING id`;
              if (!row) continue;
              for (const o of hh.offerings) {
                await sql`
                  INSERT INTO offerings
                    (happy_hour_id, kind, category, name, price_cents, original_price_cents,
                     discount_cents, description, conditions, active, source_url)
                  VALUES
                    (${row.id}, ${o.kind}::offering_kind, ${o.category}::offering_category, ${o.name},
                     ${o.priceCents}, ${o.originalPriceCents}, ${o.discountCents}, ${o.description},
                     ${o.conditions}, true, ${o.sourceUrl})`;
              }
            }
            console.log(`  ✓ upgraded — ${extracted.happyHours.length} window(s)`);
          } else {
            console.log(`  ✓ WOULD upgrade — ${extracted.happyHours.length} window(s)`);
          }
          upgraded++;
        } else {
          console.log("  ◦ keep stub — 0 windows found");
          kept++;
        }
        continue;
      }

      console.log("  ◦ keep stub");
      kept++;
    }

    const path = `docs/${city.slug}-killed-venues.md`;
    await writeFile(path, renderKillReport(city.name, killEntries), "utf8");

    console.log(`\n── ${mode} complete ──`);
    console.log(`  killed:   ${killed}${args.apply ? "" : " (would)"}`);
    console.log(`  upgraded: ${upgraded}${args.apply ? "" : " (would)"}`);
    console.log(`  guarded (kept, has data): ${guarded}`);
    console.log(`  kept:     ${kept}`);
    console.log(`  report:   ${path}`);
    if (!args.apply) console.log(`\nRe-run with --apply to perform deletes + upgrades.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
