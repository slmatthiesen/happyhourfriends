/**
 * eval-extractor — the regression gate for the happy-hour extractor.
 *
 * Runs the REAL extractor (lib/ai/extractHappyHours, the same path enrich + reextract use)
 * over a hand-verified golden set and scores how much of each venue's known happy hour it
 * reproduces — windows AND priced offerings — repeated N times so run-to-run VARIANCE is
 * visible, not hidden behind one lucky pass.
 *
 * This exists so "did this extractor change help?" is a number, not a vibe — and so a
 * recall regression can't quietly ship. Any change to the extractor/prompt/model should be
 * run through here before and after; keep it if mean recall is up and variance is down.
 *
 *   pnpm eval:extractor                 # 1 pass per golden
 *   pnpm eval:extractor --runs 3        # 3 passes — measures variance (the real signal)
 *   pnpm eval:extractor --only "Chuck"  # filter goldens by name substring
 *
 * PAID: ~3-5¢ per run per venue. Needs ANTHROPIC_API_KEY. Writes NOTHING to the DB.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractHappyHours, type ExtractResult } from "@/lib/ai/extractHappyHours";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Golden {
  name: string;
  url: string;
  type: string;
  pageKind: string;
  expectWindows: { days: number[]; start: string | null; end: string | null }[];
  offeringKeywords: string[];
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const RUNS = Number(arg("--runs") ?? "1");
const ONLY = arg("--only");

/** An expected window is found if some extracted window covers its days and matches both
 *  time bounds (null-tolerant). Extracted days may be a superset (Mon–Fri covers a Mon win). */
function windowRecall(g: Golden, r: ExtractResult): number {
  if (g.expectWindows.length === 0) return 1;
  const hit = g.expectWindows.filter((w) =>
    r.happyHours.some(
      (h) =>
        w.days.every((d) => h.daysOfWeek.includes(d)) &&
        (h.startTime ?? null) === w.start &&
        (h.endTime ?? null) === w.end,
    ),
  ).length;
  return hit / g.expectWindows.length;
}

/** Fraction of expected offering keywords present (case-insensitive) in any extracted
 *  offering's name or description. */
function offeringRecall(g: Golden, r: ExtractResult): number {
  if (g.offeringKeywords.length === 0) return 1;
  const hay = r.happyHours
    .flatMap((h) => h.offerings.map((o) => `${o.name ?? ""} ${o.description ?? ""}`))
    .join(" | ")
    .toLowerCase();
  const hit = g.offeringKeywords.filter((k) => hay.includes(k.toLowerCase())).length;
  return hit / g.offeringKeywords.length;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  const { goldens } = JSON.parse(
    readFileSync(join(root, "eval/extractor-golden.json"), "utf8"),
  ) as { goldens: Golden[] };
  const set = ONLY ? goldens.filter((g) => g.name.toLowerCase().includes(ONLY.toLowerCase())) : goldens;

  console.log(`\nExtractor eval — ${set.length} golden(s) × ${RUNS} run(s)\n`);
  const overall: { win: number[]; off: number[] } = { win: [], off: [] };

  for (const g of set) {
    const win: number[] = [];
    const off: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        // Mirror production: triage discovers the venue's HH/menu pages (and PDFs), then
        // the extractor reads them. Feeding the bare homepage skips discovery and is not
        // the path enrich/reextract actually run.
        const verdict = await triageSite({ websiteUri: g.url, name: g.name, cityName: null });
        const decided = resolveEnrichAction(
          verdict,
          hhLikelihood({ primaryType: g.type, types: null, name: g.name }),
        );
        const r = await extractHappyHours({
          venueName: g.name,
          websiteUrl: verdict.kind === "real" ? verdict.url : g.url,
          priorityUrls: decided.priorityUrls,
          forcePaid: true,
        });
        const wr = windowRecall(g, r);
        win.push(wr);
        off.push(offeringRecall(g, r));
        if (wr < 1 && process.argv.includes("--dump")) {
          console.log(
            `    · got windows: ${JSON.stringify(
              r.happyHours.map((h) => ({ d: h.daysOfWeek, s: h.startTime, e: h.endTime })),
            )}`,
          );
        }
      } catch (err) {
        console.log(`  ! ${g.name} run ${i + 1} errored: ${(err as Error).message}`);
        win.push(0);
        off.push(0);
      }
    }
    const wRuns = win.map(pct).join(" ");
    const oRuns = off.map(pct).join(" ");
    const flaky = RUNS > 1 && (Math.max(...off) - Math.min(...off) >= 0.34 || Math.max(...win) - Math.min(...win) >= 0.5);
    console.log(`  ${g.name}  [${g.pageKind}]`);
    console.log(`    windows  mean ${pct(mean(win))}   runs: ${wRuns}`);
    console.log(`    deals    mean ${pct(mean(off))}   runs: ${oRuns}${flaky ? "   ⚠ FLAKY" : ""}`);
    overall.win.push(...win);
    overall.off.push(...off);
  }

  console.log(`\n  OVERALL  windows ${pct(mean(overall.win))}   deals ${pct(mean(overall.off))}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
