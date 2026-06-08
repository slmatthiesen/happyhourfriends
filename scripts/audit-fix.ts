/**
 * audit:fix — for venues flagged auto_fixable by audit:data, re-fetch the venue's OWN pages
 * (free triage + plain HTTP), re-parse with the FIXED free parser, and apply a reversible
 * correction: update the surviving window's provenance, soft-deactivate spurious windows,
 * insert any new ones. Auto-applies ONLY high-confidence corrections; everything else is
 * reported. Free by default. Dry-run unless --apply.
 *
 * Lifecycle / exclusion: venues with fix_applied=true (corrected) or resolution='reported'
 * (re-fetched but not high-confidence or not extractable) are excluded from subsequent runs,
 * so each venue is live-fetched at most ONCE. To retry them — e.g. after improving the
 * extractor — run `audit:data --city <slug> --state <code> --recheck` first, which resets
 * their resolution back to 'scanned' so this script will pick them up again.
 *
 * Usage: pnpm tsx scripts/audit-fix.ts --city <slug> --state <code> [--apply] [--limit N]
 */
import "dotenv/config";
import postgres from "postgres";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { isHighConfidenceCorrection } from "@/lib/audit/anomalyRules";
import { computeCorrection, type StoredRow, type CorrectedWindow } from "@/lib/audit/computeCorrection";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;

interface FlaggedVenue {
  id: string;
  name: string;
  website_url: string | null;
  flags: { code: string; severity: string }[];
}

async function main() {
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const city = await resolveCity(sql, slug, state);

    const flagged = await sql<FlaggedVenue[]>`
      SELECT v.id, v.name, v.website_url, da.flags
      FROM data_audit da
      JOIN venues v ON v.id = da.venue_id
      WHERE v.city_id = ${city.id}
        AND v.status = 'active'
        AND da.fix_applied = false
        AND da.resolution <> 'reported'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(da.flags) f WHERE f->>'severity' = 'auto_fixable')
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(`[${APPLY ? "APPLY" : "DRY RUN"}] ${flagged.length} auto-fixable venue(s) in ${city.name}. Free re-fetch.\n`);
    let fixed = 0;
    let reported = 0;

    for (const v of flagged) {
      if (!v.website_url) {
        if (APPLY) await sql`UPDATE data_audit SET resolution='reported' WHERE venue_id=${v.id}`;
        reported++;
        continue;
      }

      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: null, types: null, name: v.name }));
      if (decided.action !== "extract") {
        console.log(`  – ${v.name}: site not extractable → report`);
        if (APPLY) await sql`UPDATE data_audit SET resolution='reported' WHERE venue_id=${v.id}`;
        reported++;
        continue;
      }
      const built = await buildExtractRequest({
        venueName: v.name,
        websiteUrl: verdict.kind === "real" ? verdict.url : null,
        otherUrl: null,
        cityName: city.name,
        priorityUrls: decided.priorityUrls,
        noRender: true,
      });
      const free = freeExtractFromPages(built.pages, { model: "deterministic-html-v1", promptHash: built.promptHash });

      const corrected: CorrectedWindow[] = (free?.happyHours ?? [])
        .filter((h) => !h.suspect)
        .map((h) => ({ daysOfWeek: h.daysOfWeek, startTime: h.startTime, endTime: h.endTime, allDay: h.allDay, sourceUrl: h.sourceUrl, notes: h.notes }));

      if (!isHighConfidenceCorrection(corrected)) {
        console.log(`  ⚑ ${v.name}: re-parse not high-confidence (${corrected.length} window(s)) → report only`);
        if (APPLY) await sql`UPDATE data_audit SET resolution='reported' WHERE venue_id=${v.id}`;
        reported++;
        continue;
      }

      const stored = await sql<StoredRow[]>`
        SELECT id, days_of_week AS "daysOfWeek", start_time AS "startTime", end_time AS "endTime",
               all_day AS "allDay", active, source_url AS "sourceUrl", notes
        FROM happy_hours WHERE venue_id = ${v.id} AND deleted_at IS NULL`;
      const plan = computeCorrection(stored, corrected);

      if (plan.updates.length === 0 && plan.deactivations.length === 0 && plan.inserts.length === 0) {
        console.log(`  ✓ ${v.name}: stored data already matches re-parse → mark fixed`);
        if (APPLY) await sql`UPDATE data_audit SET resolution='clean', fix_applied=true WHERE venue_id=${v.id}`;
        fixed++;
        continue;
      }

      const desc = `${plan.updates.length} update, ${plan.deactivations.length} deactivate, ${plan.inserts.length} insert`;
      if (!APPLY) {
        console.log(`  ✓ ${v.name}: WOULD apply [${desc}]`);
        fixed++;
        continue;
      }

      try {
        await sql.begin(async (tx) => {
          for (const u of plan.updates) {
            const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${u.id}`;
            await tx`UPDATE happy_hours SET source_url=${u.sourceUrl}, notes=${u.notes}, active=true, updated_at=now() WHERE id=${u.id}`;
            await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                     VALUES ('happy_hours', ${u.id}, ${tx.json(before as never)}, ${tx.json({ source_url: u.sourceUrl, notes: u.notes, active: true } as never)}, 'audit-fix', 'data audit: provenance correction')`;
          }
          for (const id of plan.deactivations) {
            const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${id}`;
            await tx`UPDATE happy_hours SET active=false, updated_at=now() WHERE id=${id}`;
            await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                     VALUES ('happy_hours', ${id}, ${tx.json(before as never)}, ${tx.json({ source_url: before.source_url, notes: before.notes, active: false } as never)}, 'audit-fix', 'data audit: deactivate spurious window')`;
          }
          for (const ins of plan.inserts) {
            const [row] = await tx`
              INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time, all_day, location_within_venue, notes, active, source_url, time_known)
              VALUES (${v.id}, ${ins.daysOfWeek}, ${ins.startTime}, ${ins.endTime}, ${ins.allDay}, 'all', ${ins.notes}, true, ${ins.sourceUrl}, ${ins.startTime !== null})
              ON CONFLICT DO NOTHING RETURNING id`;
            if (row) {
              await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                       VALUES ('happy_hours', ${row.id}, null, ${tx.json({ days_of_week: ins.daysOfWeek, start_time: ins.startTime, end_time: ins.endTime, all_day: ins.allDay, source_url: ins.sourceUrl, notes: ins.notes, active: true } as never)}, 'audit-fix', 'data audit: insert corrected window')`;
            }
          }
          await tx`UPDATE data_audit SET resolution='fixed', fix_applied=true WHERE venue_id=${v.id}`;
        });
        console.log(`  ✓ ${v.name}: APPLIED [${desc}]`);
        fixed++;
      } catch (err) {
        console.error(`  ✗ ${v.name}: transaction failed — ${(err as Error).message}`);
        reported++;
      }
    }

    console.log(`\n${APPLY ? "Applied" : "Would fix"}: ${fixed}; reported: ${reported}.`);
  } finally {
    await (await import("@/lib/verification/renderUrl")).closeRenderBrowser().catch(() => {});
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
