/**
 * apply:adjudications — apply an adjudicator report's verdicts through the audited
 * flagReview paths. The deterministic counterpart to scripts/adjudicate-flags.ts:
 *
 *   confirmed  → keepFlaggedVenue (resolution operator_kept, note carries the evidence)
 *   no_mention → stubVenueForFlag (windows hidden, venue → stub, settled)
 *   corrected  → stubVenueForFlag now + prints the targeted reextract command to run
 *                (reextract is paid + verified per venue, so it stays a separate step)
 *   unclear    → untouched (stays in the operator queue)
 *
 * Idempotent: rows whose data_audit resolution is no longer 'scanned' are skipped, so
 * re-running a report (or overlapping reports) never double-applies.
 *
 * Usage:
 *   pnpm tsx scripts/apply-adjudications.ts --report docs/audits/<file>.json           # dry-run
 *   pnpm tsx scripts/apply-adjudications.ts --report <file> --apply
 *   pnpm tsx scripts/apply-adjudications.ts --report <file> --apply --treat-corrected <venueId> …
 *     (--treat-corrected reclassifies a 'confirmed' row as corrected — operator override,
 *      e.g. 7 Mile House confirmed despite "closed Tuesdays" in the site evidence)
 *   --treat-confirmed <venueId> … is the reverse override: keep a row the judge wrongly
 *     'corrected' (Mi Patio: judge corrected over unverifiable prices while its own
 *     reason said the schedule matched; The Italian Daughter: '$7 vs $7.00' nitpick).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { db } from "@/db/client";
import { keepFlaggedVenue, stubVenueForFlag } from "@/lib/audit/flagReview";

const ADMIN = "steven.matthiesen@gmail.com";

interface ReportRow {
  venueId: string;
  venue: string;
  verdict: "confirmed" | "corrected" | "no_mention" | "unclear";
  siteSchedule: string | null;
  evidence: string | null;
  reason: string;
  pagesJudged: string[];
}

function args() {
  const a = process.argv.slice(2);
  const get = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const getAll = (f: string) => {
    const out: string[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] === f && a[i + 1]) out.push(a[i + 1]);
    return out;
  };
  return {
    report: get("--report"),
    apply: a.includes("--apply"),
    treatCorrected: new Set(getAll("--treat-corrected")),
    treatConfirmed: new Set(getAll("--treat-confirmed")),
  };
}

async function main() {
  const { report, apply, treatCorrected, treatConfirmed } = args();
  if (!report) throw new Error("--report <path to adjudication report json> is required");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const rows: ReportRow[] = JSON.parse(readFileSync(report, "utf8"));
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  const reextracts: string[] = [];
  let kept = 0;
  let stubbed = 0;
  let skipped = 0;
  let unclear = 0;

  try {
    for (const r of rows) {
      const verdict = treatConfirmed.has(r.venueId)
        ? "confirmed"
        : treatCorrected.has(r.venueId)
          ? "corrected"
          : r.verdict;
      if (verdict === "unclear") {
        unclear++;
        continue;
      }
      // Idempotence: only rows still sitting in the queue are applied.
      const [da] = await sql<{ resolution: string }[]>`
        SELECT resolution FROM data_audit WHERE venue_id = ${r.venueId}
      `;
      if (!da || da.resolution !== "scanned") {
        skipped++;
        console.log(`  ⤳ skip (resolution=${da?.resolution ?? "none"}): ${r.venue}`);
        continue;
      }

      if (verdict === "confirmed") {
        if (apply) {
          await keepFlaggedVenue(db, {
            venueId: r.venueId,
            adminEmail: ADMIN,
            note: `Adjudicator confirmed vs own site — ${(r.evidence ?? r.reason).slice(0, 280)}`,
          });
        }
        kept++;
        console.log(`  ✓ keep: ${r.venue}`);
      } else if (verdict === "no_mention") {
        if (apply) {
          await stubVenueForFlag(db, {
            venueId: r.venueId,
            adminEmail: ADMIN,
            reason: `Flag review (adjudicator): own site has no happy-hour mention — ${r.reason.slice(0, 280)}`,
          });
        }
        stubbed++;
        console.log(`  ⊘ stub: ${r.venue}`);
      } else {
        // corrected
        if (apply) {
          await stubVenueForFlag(db, {
            venueId: r.venueId,
            adminEmail: ADMIN,
            reason: `Flag review (adjudicator, corrected): ${r.reason.slice(0, 280)}`,
          });
        }
        stubbed++;
        const urls = r.pagesJudged.slice(0, 2).map((u) => `--url ${u}`).join(" ");
        reextracts.push(`pnpm reextract:stubs --venue ${r.venueId} ${urls}  # ${r.venue}`);
        console.log(`  ✎ corrected (hidden, reextract pending): ${r.venue}`);
      }
    }
  } finally {
    await sql.end();
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY RUN"} — keep: ${kept}, stub/hide: ${stubbed}, unclear (left queued): ${unclear}, skipped (already settled): ${skipped}`,
  );
  if (reextracts.length) {
    console.log(`\nTargeted reextracts to run + verify (paid, ~2¢ each):`);
    for (const c of reextracts) console.log(`  ${c}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
