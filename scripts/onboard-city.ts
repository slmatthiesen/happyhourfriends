/**
 * onboard:city — one-shot city onboarding orchestrator.
 *
 * Runs the full PAID pipeline behind a SINGLE upfront cost confirm, then stops at the operator
 * review / go-live gate. Sequence:
 *   1. seed:discover  — Nearby sweep + HH-recall (default), all gates, boundary, metadata capture
 *   2. seed:enrich --batch — free-first HTML parse, then the paid extractor; assigns neighborhoods
 *   3. summary — city-wide live / stub / review-window counts + the /admin/reviews pointer
 *
 * It does NOT flip the city live and does NOT touch prod — both are operator-only (per the
 * standing rules). The single confirm satisfies the per-run $-OK gate for the whole pipeline.
 *
 * Usage:
 *   pnpm tsx scripts/onboard-city.ts --city <slug> --state <code> [--yes] [--estimate]
 *        [--max-calls N] [--debug-drops] [--no-hh-recall] [--limit N]
 *
 *   --estimate  Preview the discovery call plan ($0) and stop before any paid step.
 *   --yes       Skip the interactive confirm. REQUIRED when run non-interactively (no TTY),
 *               e.g. by an agent or cron — otherwise the confirm prompt blocks forever.
 *   Other flags pass through to the underlying steps.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import postgres from "postgres";

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const slug = argValue("--city");
const state = argValue("--state");
if (!slug || !state) {
  console.error(
    "Usage: pnpm tsx scripts/onboard-city.ts --city <slug> --state <code> " +
      "[--yes] [--estimate] [--max-calls N] [--debug-drops] [--no-hh-recall] [--limit N]",
  );
  process.exit(1);
}

// Flags that pass through to the underlying steps.
const discoverPass: string[] = [];
// HH recall is adaptive by default now (saturated regions self-subdivide); the old --sub-tile
// opt-in is gone. --max-calls forwards the recall cost cap to seed:discover.
const maxCalls = argValue("--max-calls");
if (maxCalls) discoverPass.push("--max-calls", maxCalls);
if (hasFlag("--debug-drops")) discoverPass.push("--debug-drops");
if (hasFlag("--no-hh-recall")) discoverPass.push("--no-hh-recall");
const enrichPass: string[] = [];
const limit = argValue("--limit");
if (limit) enrichPass.push("--limit", limit);

/** Spawn `pnpm tsx <script> ...args`, streaming output. Rejects on a non-zero exit. */
function runStep(label: string, scriptArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n━━ ${label} ━━\n  pnpm tsx ${scriptArgs.join(" ")}`);
    const child = spawn("pnpm", ["tsx", ...scriptArgs], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`)),
    );
  });
}

async function printSummary() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const [row] = await sql<
      { venues: number; live_venues: number; venues_with_any_hh: number; review_windows: number }[]
    >`
      SELECT
        count(DISTINCT v.id)                                          AS venues,
        count(DISTINCT v.id) FILTER (WHERE hh.active)                 AS live_venues,
        count(DISTINCT v.id) FILTER (WHERE hh.id IS NOT NULL)         AS venues_with_any_hh,
        count(hh.id)        FILTER (WHERE hh.active IS FALSE)          AS review_windows
      FROM venues v
      LEFT JOIN happy_hours hh ON hh.venue_id = v.id
      JOIN cities c ON c.id = v.city_id
      WHERE lower(c.slug) = ${slug!.toLowerCase()} AND lower(c.state) = ${state!.toLowerCase()}
    `;
    if (row) {
      const stubs = Number(row.venues) - Number(row.venues_with_any_hh);
      console.log(`\n── Onboarding summary: ${slug}, ${state} (city-wide) ──`);
      console.log(`  venues:            ${row.venues}`);
      console.log(`  live (active HH):  ${row.live_venues}`);
      console.log(`  stubs (no HH):     ${stubs}`);
      console.log(`  review windows:    ${row.review_windows}  → work these in /admin/reviews`);
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  const boundary = `data/${slug}-boundary.geojson`;
  console.log(
    `Onboarding ${slug}, ${state}.  Boundary: ${existsSync(boundary) ? boundary : "none → RADIUS mode"}`,
  );

  // Step 0 — cost preview ($0). Discovery prints its worst-case call plan; enrich cost is
  // variable and small (free-first handles most; --batch is ~50% off), so we note it verbally.
  await runStep("Cost preview (discover --estimate, $0)", [
    "scripts/seed-discover.ts",
    "--city", slug!,
    "--state", state!,
    "--estimate",
    ...discoverPass,
  ]);
  console.log(
    "\nEnrich cost is variable but small: free-first HTML parse is $0; only signal-bearing\n" +
      "net-new candidates hit the paid batch (~$0–0.15/city observed). --batch is ~50% off.",
  );

  if (hasFlag("--estimate")) {
    console.log("\n--estimate: stopping before any paid step.");
    return;
  }

  // Single $-OK gate for the whole paid pipeline.
  if (!hasFlag("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("\nProceed with PAID discover + enrich? [y/N] ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted — no paid calls made.");
      return;
    }
  }

  await runStep("Discover (Nearby + HH recall)", [
    "scripts/seed-discover.ts",
    "--city", slug!,
    "--state", state!,
    ...discoverPass,
  ]);
  await runStep("Enrich (batch)", [
    "scripts/seed-enrich-candidates.ts",
    "--city", slug!,
    "--state", state!,
    "--batch",
    ...enrichPass,
  ]);

  // Gate phase — $0, reversible, and EASY TO FORGET by hand (neither is a seed:*/reconcile:*
  // step). `active` is stored at persist time, so regate re-evaluates windows the current
  // gate already passes (it benched 5 real HH on San Mateo before it was wired in); the
  // combo-cuisine drop is an operator "every city" rule. Running them here makes them
  // non-optional. reconcile:windows is intentionally NOT run — the reconcile gate already
  // fires at enrich-persist, so it's a near-permanent no-op (run on demand only if needed).
  await runStep("Regate (promote/demote stale-gated windows)", [
    "scripts/regate-hidden.ts",
    "--city", slug!,
    "--state", state!,
    "--apply",
  ]);
  await runStep("Drop combo-cuisine non-HH windows", [
    "scripts/drop-combo-cuisine-hh.ts",
    "--city", slug!,
    "--state", state!,
    "--apply",
  ]);

  await printSummary();

  console.log(
    `\nNEXT (operator-only): review /admin/reviews, then flip the city live and run the prod ` +
      `data sync. Onboarding stops here by design.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
