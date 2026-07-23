/**
 * CLI for the safe local⇄prod data sync (lib/sync/dbSync.ts).
 *
 *   tsx scripts/sync/db-sync.ts push [--apply]   # local → prod, additive (new venues)
 *   tsx scripts/sync/db-sync.ts pull [--apply]   # prod → local, non-destructive upsert
 *
 * Connections:
 *   DATABASE_URL       local dev DB (from .env)
 *   PROD_DATABASE_URL  prod DB — normally pointed at an SSH tunnel by the bash
 *                      wrappers (scripts/push-data-additive-ssm.sh / push-updates-ssm.sh),
 *                      so prod credentials are never persisted on disk.
 *
 * Defaults to a DRY RUN (rolls back, prints the counts that WOULD change). Pass
 * --apply to commit. Neither direction ever truncates or deletes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { additivePush, upsertPull, publishVenue, publishChanged, pullQueuedSubmissions, markSubmissionRejected, pushDeletions, type SyncResult } from "@/lib/sync/dbSync";

// Persists when push-updates last successfully applied, so the next run only re-scans
// venues touched since then instead of a fixed rolling window (which either reprocesses
// the same recent edits every run, or silently misses edits older than the window if
// push-updates hasn't run in a while). Gitignored — local runtime state, not repo state.
const WATERMARK_PATH = "./.push-prod-state.json";

function readWatermarkMs(): number | undefined {
  try {
    const { lastPushedAt } = JSON.parse(readFileSync(WATERMARK_PATH, "utf8"));
    const ms = Date.parse(lastPushedAt);
    return Number.isNaN(ms) ? undefined : ms;
  } catch {
    return undefined; // first run, or file missing/corrupt — caller falls back to sinceHours
  }
}

function writeWatermarkMs(ms: number) {
  writeFileSync(WATERMARK_PATH, JSON.stringify({ lastPushedAt: new Date(ms).toISOString() }, null, 2));
}

function connect(url: string) {
  // Low ceiling: this is a short batch job, not the app pool.
  return postgres(url, { max: 4, idle_timeout: 10, onnotice: () => {} });
}

function printResults(title: string, results: SyncResult[], dryRun: boolean) {
  const total = results.reduce((n, r) => n + r.changed, 0);
  console.log(`\n${title}${dryRun ? " (DRY RUN — nothing written)" : ""}`);
  for (const r of results) {
    if (r.changed > 0) console.log(`  ${r.table.padEnd(24)} ${r.changed}`);
  }
  console.log(`  ${"TOTAL".padEnd(24)} ${total}`);
}

async function main() {
  const [direction, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  const dryRun = !apply;

  const VALID = ["push", "push-updates", "pull", "publish-venue", "pull-queue", "reject-submission", "delete-venues"];
  if (!VALID.includes(direction)) {
    console.error("Usage: db-sync.ts <push|push-updates|pull|publish-venue|pull-queue|reject-submission|delete-venues> [--apply] [--full] [--venue <id>] [--submission <id>]");
    process.exit(1);
  }

  const localUrl = process.env.DATABASE_URL;
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!localUrl) throw new Error("DATABASE_URL is not set (local DB)");
  if (!prodUrl) throw new Error("PROD_DATABASE_URL is not set (prod DB / tunnel)");

  const flagValue = (name: string): string | undefined => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };

  const local = connect(localUrl);
  const prod = connect(prodUrl);
  try {
    if (direction === "push") {
      printResults("local → prod (additive push)", await additivePush(local, prod, { dryRun }), dryRun);
    } else if (direction === "push-updates") {
      // Complete up-sync of curation: insert new venues, then re-publish existing ones
      // whose local subtree changed (edited windows, hidden offerings, …). User data is
      // never touched, and venues a user edited more recently on prod are skipped.
      printResults("local → prod (additive push — new venues)", await additivePush(local, prod, { dryRun }), dryRun);

      const full = flags.includes("--full");
      const runStartedAt = Date.now();
      const watermarkMs = readWatermarkMs();
      const published = await publishChanged(local, prod, { dryRun, cutoffMs: watermarkMs, full });
      const scopeNote = full
        ? "FULL reconcile — every venue where local differs from prod (watermark ignored)"
        : watermarkMs
          ? `since last push (${new Date(watermarkMs).toISOString()})`
          : "since last push — no watermark yet, defaulting to last 24h";
      console.log(`\nlocal → prod (update changed venues, ${scopeNote})${dryRun ? " (DRY RUN — nothing written)" : ""}`);
      if (published.length === 0) {
        console.log("  (no existing venue is newer locally than on prod)");
      } else {
        for (const p of published) {
          const rows = p.results.reduce((n, r) => n + r.changed, 0);
          console.log(`  ${p.venueId}  ${rows} row(s)`);
        }
        console.log(`  ${"TOTAL VENUES".padEnd(24)} ${published.length}`);
      }
      // Advance the watermark only on a real apply, to the moment this run started (not
      // finished) — so any edit made mid-run is still caught by the next push.
      if (!dryRun) writeWatermarkMs(runStartedAt);
    } else if (direction === "pull") {
      printResults("prod → local (upsert pull)", await upsertPull(prod, local, { dryRun }), dryRun);
    } else if (direction === "pull-queue") {
      printResults("prod → local (queued_admin submissions)", await pullQueuedSubmissions(prod, local, { dryRun }), dryRun);
    } else if (direction === "reject-submission") {
      const submissionId = flagValue("--submission");
      if (!submissionId) throw new Error("reject-submission requires --submission <id>");
      printResults("prod (mark submission rejected)", await markSubmissionRejected(prod, submissionId, { dryRun }), dryRun);
    } else if (direction === "delete-venues") {
      printResults("local → prod (propagate soft-deletions)", await pushDeletions(local, prod, { dryRun }), dryRun);
    } else {
      const venueId = flagValue("--venue");
      if (!venueId) throw new Error("publish-venue requires --venue <id>");
      const submissionId = flagValue("--submission");
      printResults(
        `local → prod (publish venue ${venueId})`,
        await publishVenue(local, prod, { venueId, submissionId, dryRun }),
        dryRun,
      );
    }
    if (dryRun) console.log("\nRe-run with --apply to commit.");
  } finally {
    await local.end({ timeout: 5 });
    await prod.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
