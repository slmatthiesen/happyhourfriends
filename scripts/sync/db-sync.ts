/**
 * CLI for the safe local⇄prod data sync (lib/sync/dbSync.ts).
 *
 *   tsx scripts/sync/db-sync.ts push [--apply]   # local → prod, additive (new venues)
 *   tsx scripts/sync/db-sync.ts pull [--apply]   # prod → local, non-destructive upsert
 *
 * Connections:
 *   DATABASE_URL       local dev DB (from .env)
 *   PROD_DATABASE_URL  prod DB — normally pointed at an SSH tunnel by the bash
 *                      wrappers (scripts/push-data-additive.sh / pull-data-upsert.sh),
 *                      so prod credentials are never persisted on disk.
 *
 * Defaults to a DRY RUN (rolls back, prints the counts that WOULD change). Pass
 * --apply to commit. Neither direction ever truncates or deletes.
 */
import postgres from "postgres";
import { additivePush, upsertPull, publishVenue, pullQueuedSubmissions, type SyncResult } from "@/lib/sync/dbSync";

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

  const VALID = ["push", "pull", "publish-venue", "pull-queue"];
  if (!VALID.includes(direction)) {
    console.error("Usage: db-sync.ts <push|pull|publish-venue|pull-queue> [--apply] [--venue <id>] [--submission <id>]");
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
    } else if (direction === "pull") {
      printResults("prod → local (upsert pull)", await upsertPull(prod, local, { dryRun }), dryRun);
    } else if (direction === "pull-queue") {
      printResults("prod → local (queued_admin submissions)", await pullQueuedSubmissions(prod, local, { dryRun }), dryRun);
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
