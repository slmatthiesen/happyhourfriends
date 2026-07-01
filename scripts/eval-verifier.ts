/**
 * eval-verifier — regression gate for the Stage-2 verifier (lib/ai/verifier).
 *
 * Runs the REAL verify() path over a hand-seeded golden set and scores whether its
 * confirm/contradict/unconfirmed verdict matches the expected one, repeated N times so
 * run-to-run VARIANCE is visible. This exists so the split-model design (cheap Haiku loop
 * + Sonnet vision sidecar) can't quietly regress verdict accuracy vs. the old all-Sonnet
 * verifier — run it before/after any verifier/prompt/model change and keep the change only
 * if agreement holds and cost drops.
 *
 * A/B the loop model straight from the shell (models.ts reads these at import):
 *   pnpm eval:verifier                                          # current default (Haiku loop)
 *   ANTHROPIC_MODEL_VERIFIER=claude-sonnet-4-6 pnpm eval:verifier   # old all-Sonnet baseline
 *
 *   pnpm eval:verifier --runs 3        # 3 passes per golden — measures variance
 *   pnpm eval:verifier --only "Cheers" # filter goldens by name substring
 *
 * PAID: ~2-6¢ per run per golden (vision goldens cost more). Needs ANTHROPIC_API_KEY.
 * Writes NOTHING to the DB.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verify, type VerifyInput } from "@/lib/ai/verifier";
import { readEvidenceForModel } from "@/lib/submit/evidenceStore";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type Verdict = "confirmed" | "contradicted" | "unconfirmed";

interface Golden {
  name: string;
  venueName: string;
  websiteUrl: string | null;
  otherUrl: string | null;
  diffSummary: string;
  evidenceFile: { url: string; mime: string } | null;
  expected: Verdict;
  truth: boolean;
  note?: string;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const RUNS = Number(arg("--runs") ?? "1");
const ONLY = arg("--only");

function verdictOf(confirmed: boolean | null): Verdict {
  if (confirmed === true) return "confirmed";
  if (confirmed === false) return "contradicted";
  return "unconfirmed";
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  const { goldens } = JSON.parse(
    readFileSync(join(root, "eval/verifier-golden.json"), "utf8"),
  ) as { goldens: Golden[] };
  const set = ONLY
    ? goldens.filter((g) => g.name.toLowerCase().includes(ONLY.toLowerCase()))
    : goldens;

  console.log(`\nVerifier eval — ${set.length} golden(s) × ${RUNS} run(s)\n`);
  const agree: number[] = [];
  const truthAgree: number[] = [];
  let totalCents = 0;
  const modelsSeen = new Set<string>();

  for (const g of set) {
    const evidenceMedia = g.evidenceFile
      ? await readEvidenceForModel(g.evidenceFile.url, g.evidenceFile.mime)
      : null;
    if (g.evidenceFile && !evidenceMedia) {
      console.log(`  ! ${g.name}: evidence file missing (${g.evidenceFile.url}) — skipping`);
      continue;
    }
    const input: VerifyInput = {
      venueName: g.venueName,
      websiteUrl: g.websiteUrl,
      otherUrl: g.otherUrl,
      diffSummary: g.diffSummary,
      evidenceMedia,
    };

    const got: Verdict[] = [];
    const conf: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await verify(input);
        got.push(verdictOf(r.confirmed));
        conf.push(r.confidence);
        totalCents += r.costCents;
        modelsSeen.add(r.model);
      } catch (err) {
        console.log(`  ! ${g.name} run ${i + 1} errored: ${(err as Error).message}`);
        got.push("unconfirmed");
        conf.push(0);
      }
    }
    const hits = got.map((v) => (v === g.expected ? 1 : 0));
    const rate = mean(hits);
    agree.push(...hits);
    if (g.truth) truthAgree.push(...hits);
    const flag = rate < 1 ? (g.truth ? "  ✗ TRUTH MISS" : "  · diverges from reference") : "";
    console.log(`  ${g.name}  [${g.truth ? "truth" : "ref"}]`);
    console.log(
      `    expected ${g.expected}  ·  got: ${got.join(" ")}  ·  conf: ${conf.map((c) => c.toFixed(2)).join(" ")}${flag}`,
    );
  }

  console.log(
    `\n  OVERALL agreement ${pct(mean(agree))}   (truth-only ${pct(mean(truthAgree))})`,
  );
  console.log(`  MODEL(S): ${[...modelsSeen].join(", ") || "n/a"}`);
  console.log(`  SPEND: ${(totalCents / 100).toFixed(2)} USD across ${set.length * RUNS} verifications\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
