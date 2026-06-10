/**
 * eval:flags — score the CURRENT anomaly-rule catalog against the operator-labeled
 * flag-review corpus (data/flag-review-goldens.json). $0, hermetic: no DB/network/AI.
 *
 * REPORT-ONLY by design (operator 2026-06-09): always exits 0 on a valid corpus. The
 * point is to see, per rule change, what we newly catch and what we stop bothering the
 * operator with — not to gate CI while the corpus is small. Tighten later.
 *
 * Reading the report:
 *   kept+silent   — rules no longer flag data the operator adjudicated GOOD (learned).
 *   kept+flagged  — rules still raise a false alarm on adjudicated-good data (rule-gap
 *                   candidates: mine these for the next exemption/threshold).
 *   hidden+flagged — true catches retained.
 *   hidden+silent  — REGRESSION: the catalog lost a catch the operator confirmed wrong.
 *
 * Usage: pnpm tsx scripts/eval-flag-rules.ts
 */
import { readFileSync } from "node:fs";
import { evalCases, type FlagLabelCase } from "@/lib/audit/flagEval";

const CORPUS = "data/flag-review-goldens.json";

let cases: FlagLabelCase[];
try {
  cases = JSON.parse(readFileSync(CORPUS, "utf8"));
} catch (e) {
  console.error(`Cannot read ${CORPUS} — run \`npm run export:flag-labels\` first. (${e})`);
  process.exit(1);
}

const report = evalCases(cases);

console.log(`eval:flags — ${cases.length} labeled case(s) from ${CORPUS}\n`);
console.log(`kept   (operator says data is good): ${report.keptSilent}/${report.keptTotal} now pass silently`);
console.log(`hidden (operator says data is wrong): ${report.hiddenCaught}/${report.hiddenTotal} still caught\n`);

console.log("Per-code hits on the corpus (keptHits = false alarms, hiddenHits = retained catches):");
const codes = Object.entries(report.perCode).sort(([a], [b]) => a.localeCompare(b));
if (codes.length === 0) console.log("  (no flags raised on any case)");
for (const [code, s] of codes) console.log(`  ${code.padEnd(24)} kept:${s.keptHits}  hidden:${s.hiddenHits}`);

const disagreements = report.results.filter((r) => !r.agrees);
console.log(`\nDisagreements (${disagreements.length}):`);
for (const r of disagreements) {
  const c = r.case_;
  if (c.label === "kept") {
    console.log(`  KEPT but still flagged — ${c.venue} (${c.city}/${c.slug})${c.note ? ` note: ${c.note}` : ""}`);
    for (const f of r.flagsNow) console.log(`      ${f.code}: ${f.evidence}`);
  } else {
    console.log(`  HIDDEN but now SILENT — ${c.venue} (${c.city}/${c.slug}) hid: ${c.hiddenWindows.join("; ") || "?"}`);
    console.log(`      at verdict: ${c.flagsAtVerdict.map((f) => f.code).join(", ") || "none"}`);
  }
}
if (disagreements.length === 0) console.log("  (none — rules fully agree with the operator)");
