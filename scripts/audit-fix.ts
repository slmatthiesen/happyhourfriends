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
import { buildExtractRequest, extractHappyHours } from "@/lib/ai/extractHappyHours";
import type { ExtractResult } from "@/lib/ai/extractHappyHours";
import { mkdirSync, writeFileSync } from "node:fs";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { isHighConfidenceCorrection } from "@/lib/audit/anomalyRules";
import { computeCorrection, type StoredRow, type CorrectedWindow } from "@/lib/audit/computeCorrection";
import { needsRenderEscalation } from "@/lib/audit/renderEscalation";
import { persistExtractedWindows } from "@/lib/recover/resolveVenue";
import { renderUrl, closeRenderBrowser } from "@/lib/verification/renderUrl";
import { hasHhOrDealSignal } from "@/lib/places/hhText";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const ESCALATE = process.argv.includes("--escalate-paid");
const PREVIEW = process.argv.includes("--preview");
const ESTIMATE = process.argv.includes("--estimate");
const APPLY_FROM = arg("--apply-from"); // path to a previously-previewed report json
const ESC_VENUE = arg("--venue"); // optional venue UUID to restrict escalation to one venue
const ESCALATION_COST_EST_USD = 0.05; // ~1 render + 1 Sonnet extract (observed 3–5¢)

interface EscalationCandidate {
  id: string;
  name: string;
  website_url: string | null;
}

async function runEscalation(
  sql: ReturnType<typeof postgres>,
  city: { id: string; name: string; slug: string },
) {
  const candidates = await sql<EscalationCandidate[]>`
    SELECT v.id, v.name, v.website_url
    FROM venues v
    WHERE v.city_id = ${city.id} AND v.status = 'active' AND v.deleted_at IS NULL
      AND v.website_url IS NOT NULL
      AND (
        v.data_completeness = 'stub'
        OR EXISTS (
          SELECT 1 FROM data_audit da
          WHERE da.venue_id = v.id AND jsonb_array_length(da.flags) > 0
        )
      )
      ${ESC_VENUE ? sql`AND v.id = ${ESC_VENUE}` : sql``}
    ORDER BY v.name
    ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

  console.log(`[escalate] ${candidates.length} candidate venue(s) (stubs ∪ flagged) in ${city.name}. Free detection — $0.\n`);

  const toEscalate: { v: EscalationCandidate; reason: string; hhPage: string }[] = [];
  for (const v of candidates) {
    const verdict = await triageSite({ websiteUri: v.website_url!, name: v.name, cityName: city.name });
    const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: null, types: null, name: v.name }));
    if (decided.action !== "extract") continue;
    const built = await buildExtractRequest({
      venueName: v.name,
      websiteUrl: verdict.kind === "real" ? verdict.url : null,
      otherUrl: null,
      cityName: city.name,
      priorityUrls: decided.priorityUrls,
      noRender: true,
    });
    const free = freeExtractFromPages(built.pages, { model: "deterministic-html-v1", promptHash: built.promptHash });
    const esc = needsRenderEscalation({
      priorityUrls: decided.priorityUrls,
      readUrls: built.pages.map((p) => p.url),
      freeWindows: free ? free.happyHours.map((h) => ({ offerings: h.offerings })) : null,
    });
    if (esc.escalate) {
      toEscalate.push({ v, reason: esc.reason!, hhPage: esc.hhPages[0] ?? "?" });
      console.log(`  ⏫ ${v.name}: would escalate [${esc.reason}] (HH page: ${esc.hhPages[0] ?? "?"})`);
    }
  }

  if (ESTIMATE) {
    let billable = 0;
    let free = 0;
    const freeList: string[] = [];
    try {
      for (const c of toEscalate) {
        let isBillable = false;
        try {
          const r = await renderUrl(c.hhPage);
          isBillable = !!(r.ok && (r.isPdf || r.isImage || (r.contentText && hasHhOrDealSignal(r.contentText))));
        } catch {
          isBillable = false; // render failed → no content → $0
        }
        if (isBillable) {
          billable++;
          console.log(`  $ ${c.v.name}: BILLABLE (renderable HH content at ${c.hhPage})`);
        } else {
          free++;
          freeList.push(c.v.name);
        }
      }
    } finally {
      await closeRenderBrowser();
    }
    const lo = (billable * 0.03).toFixed(2);
    const hi = (billable * 0.05).toFixed(2);
    console.log(`\n=== ESTIMATE ===`);
    console.log(`Candidates flagged: ${toEscalate.length}`);
    console.log(`BILLABLE (have renderable HH content → ~$0.03–0.05 each): ${billable}  → est $${lo}–$${hi}`);
    console.log(`FREE (no PDF/content → $0, model skipped): ${free}`);
    if (freeList.length) console.log(`\nFree venues (no model call needed):\n${freeList.map((n) => `  - ${n}`).join("\n")}`);
    console.log(`\nNo model calls were made — this estimate cost $0.`);
    return;
  }

  if (!PREVIEW && !APPLY) {
    const est = (toEscalate.length * ESCALATION_COST_EST_USD).toFixed(2);
    console.log(`\n${toEscalate.length} venue(s) would escalate. Est. paid cost: ~$${est}.`);
    console.log(`Re-run with --preview (report, no write) or --apply (apply).`);
    return;
  }

  const results: EscalationResult[] = [];
  try {
    for (const c of toEscalate) {
      const r = await extractAndDiff(sql, city.name, c);
      results.push(r);
      const offers = r.found.reduce((a, w) => a + w.offerings.length, 0);
      console.log(`  ⏫ ${r.name}: found ${r.found.length} window(s), ${offers} offering(s)${r.highConfidence ? "" : " [LOW-CONF → report]"} ($${(r.costCents / 100).toFixed(3)})`);
    }
  } finally {
    await closeRenderBrowser().catch(() => {});
  }

  mkdirSync("docs/audit-escalation", { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(`docs/audit-escalation/${city.slug}-${date}.json`, JSON.stringify(results, null, 2));
  const md: string[] = [
    `# Escalation review — ${city.name} (${date})`, "",
    `${results.length} venue(s) extracted. Total spend: $${(results.reduce((a, r) => a + r.costCents, 0) / 100).toFixed(2)}.`, "",
  ];
  for (const r of results) {
    md.push(`## ${r.name}  [${r.reason}]  ${r.highConfidence ? "→ would apply" : "→ report only (low confidence)"}`);
    md.push(`HH page: ${r.hhPage}`);
    md.push(`**STORED (now):**`);
    for (const w of r.storedActive) md.push(`  - ${JSON.stringify(w.days)} ${w.start ?? "open"}–${w.end ?? "close"}  offerings:${w.offerings}  src=${w.src ?? "—"}`);
    md.push(`**FOUND (render+PDF):**`);
    for (const w of r.found) md.push(`  - ${JSON.stringify(w.days)} ${w.start ?? "open"}–${w.end ?? "close"}  offerings:${w.offerings.length} [${w.offerings.slice(0, 6).map((o) => o.name ?? "(unnamed)").join(", ")}]  src=${w.src ?? "—"}`);
    md.push(`**PROPOSED CHANGE:** insert ${r.found.length} window(s)+offerings; deactivate ${r.deactivateIds.length} prior window(s).`);
    md.push("");
  }
  writeFileSync(`docs/${city.slug}-escalation-review-${date}.md`, md.join("\n"));
  console.log(`\nReview report → docs/${city.slug}-escalation-review-${date}.md  (cache: docs/audit-escalation/${city.slug}-${date}.json)`);

  if (PREVIEW && !APPLY) {
    console.log(`PREVIEW only — NO DB writes. Review the report, then run with --apply-from docs/audit-escalation/${city.slug}-${date}.json`);
    return;
  }
  await applyEscalationResults(sql, city.id, results);
}

interface EscalationResult {
  venueId: string;
  name: string;
  hhPage: string;
  reason: string;
  storedActive: { days: number[]; start: string | null; end: string | null; offerings: number; src: string | null }[];
  found: { days: number[]; start: string | null; end: string | null; offerings: { name: string | null; price: number | null }[]; src: string | null }[];
  highConfidence: boolean;
  costCents: number;
  extracted: unknown; // ExtractResult, cached for --apply-from
  // Prior active-window ids to soft-deactivate, SNAPSHOTTED at preview/extract time. Safe to use
  // later at --apply-from time: persist uses ON CONFLICT DO NOTHING (a matched-key window is never
  // in this list), and applyEscalationResults skips any id already inactive (`if (!before)`).
  deactivateIds: string[];
}

async function extractAndDiff(
  sql: ReturnType<typeof postgres>,
  cityName: string,
  c: { v: EscalationCandidate; reason: string; hhPage: string },
): Promise<EscalationResult> {
  const verdict = await triageSite({ websiteUri: c.v.website_url!, name: c.v.name, cityName });
  const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: null, types: null, name: c.v.name }));
  const hhPage = c.hhPage; // the unread HH-specific page the detector found
  const extracted = await extractHappyHours({
    venueName: c.v.name,
    websiteUrl: hhPage,                              // fetched FIRST → render (JS shell → PDF)
    otherUrl: verdict.kind === "real" ? verdict.url : c.v.website_url, // keep the real site as backup
    cityName,
    priorityUrls: decided.priorityUrls.filter((u) => u !== hhPage),
    forcePaid: true,                                 // skip free-first; always render+model
  });
  const stored = await sql<StoredRow[]>`
    SELECT id, days_of_week AS "daysOfWeek", start_time AS "startTime", end_time AS "endTime",
           all_day AS "allDay", active, source_url AS "sourceUrl", notes
    FROM happy_hours WHERE venue_id = ${c.v.id} AND deleted_at IS NULL AND active = true`;
  const corrected: CorrectedWindow[] = extracted.happyHours
    .filter((h) => !h.suspect)
    .map((h) => ({ daysOfWeek: h.daysOfWeek, startTime: h.startTime, endTime: h.endTime, allDay: h.allDay, sourceUrl: h.sourceUrl, notes: h.notes }));
  const highConfidence = isHighConfidenceCorrection(corrected);
  const plan = computeCorrection(stored, corrected);
  const offRows = stored.length
    ? await sql<{ id: string; n: number }[]>`
        SELECT happy_hour_id AS id, count(*)::int AS n FROM offerings
        WHERE happy_hour_id = ANY(${stored.map((s) => s.id)}) AND active = true GROUP BY happy_hour_id`
    : [];
  const offCount = new Map(offRows.map((r) => [r.id, r.n]));
  return {
    venueId: c.v.id,
    name: c.v.name,
    hhPage: c.hhPage,
    reason: c.reason,
    storedActive: stored.map((s) => ({ days: s.daysOfWeek, start: s.startTime, end: s.endTime, offerings: offCount.get(s.id) ?? 0, src: s.sourceUrl })),
    found: extracted.happyHours.filter((h) => !h.suspect).map((h) => ({ days: h.daysOfWeek, start: h.startTime, end: h.endTime, offerings: h.offerings.map((o) => ({ name: o.name, price: o.priceCents })), src: h.sourceUrl })),
    highConfidence,
    costCents: extracted.costCents,
    extracted,
    deactivateIds: plan.deactivations,
  };
}

async function applyEscalationResults(
  sql: ReturnType<typeof postgres>,
  cityId: string,
  results: EscalationResult[],
): Promise<void> {
  let applied = 0;
  let reported = 0;
  for (const r of results) {
    if (!r.highConfidence) {
      await sql`UPDATE data_audit SET resolution='reported' WHERE venue_id=${r.venueId}`;
      console.log(`  ⚑ ${r.name}: low confidence → report only`);
      reported++;
      continue;
    }
    try {
      // PARTIAL-APPLY FAILURE MODE: persist (drizzle db) runs OUTSIDE the postgres.js txn below,
      // so if the deactivation txn throws after persist commits, the venue is left with BOTH the
      // new windows and the superseded old ones active. Recoverable: re-run `audit:data --recheck`
      // (re-flags it) then `audit:fix --apply` / `--escalate-paid --apply`. Acceptable for an
      // operator-run CLI; do NOT promote to a server retry-loop without making this one txn.
      // 1) Land the paid windows + offerings via the ONE audited persist path (drizzle db).
      await persistExtractedWindows({
        venueId: r.venueId,
        cityId,
        extracted: r.extracted as ExtractResult,
        actor: "audit-escalate",
      });
      // 2) Soft-deactivate prior windows the new set supersedes (audit_log each), in a txn.
      await sql.begin(async (tx) => {
        for (const id of r.deactivateIds) {
          const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${id} AND active=true`;
          if (!before) continue; // already inactive / absorbed by persist
          await tx`UPDATE happy_hours SET active=false, updated_at=now() WHERE id=${id}`;
          await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                   VALUES ('happy_hours', ${id}, ${tx.json(before as never)}, ${tx.json({ source_url: before.source_url, notes: before.notes, active: false } as never)}, 'audit-escalate', 'render-escalation: deactivate superseded window')`;
        }
        await tx`UPDATE data_audit SET resolution='fixed', fix_applied=true WHERE venue_id=${r.venueId}`;
      });
      const offers = r.found.reduce((a, w) => a + w.offerings.length, 0);
      console.log(`  ✓ ${r.name}: applied ${r.found.length} window(s) + ${offers} offering(s); deactivated ${r.deactivateIds.length} prior`);
      applied++;
    } catch (err) {
      console.error(`  ✗ ${r.name}: apply failed — ${(err as Error).message}`);
      reported++;
    }
  }
  console.log(`\nEscalation applied: ${applied}; reported: ${reported}.`);
}

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

    if (ESCALATE && !APPLY_FROM) {
      await runEscalation(sql, city);
      return; // escalation owns this run; later tasks add preview/apply branches
    }

    if (APPLY_FROM) {
      const { readFileSync } = await import("node:fs");
      const results = JSON.parse(readFileSync(APPLY_FROM, "utf8")) as EscalationResult[];
      console.log(`[apply-from] ${results.length} previewed result(s) from ${APPLY_FROM}. No re-extraction (spend already incurred).`);
      await applyEscalationResults(sql, city.id, results);
      return;
    }

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
    await closeRenderBrowser().catch(() => {});
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
