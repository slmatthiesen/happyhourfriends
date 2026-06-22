/**
 * FREE ($0) discovery regression check for the extractor goldens. Runs ONLY triageSite
 * (plain HTTP page discovery — NO model call, no Anthropic billing) over each golden and
 * reports the HH/menu URLs it still surfaces. Guards discovery-precision changes (tightened
 * CONTENT_HINT, gated multilingual guesses): if a change drops the page that carries a
 * golden's happy hour, recall regresses — this catches it without paying for extraction.
 *
 * A golden PASSES if discovery still yields ≥1 HH/menu-signal URL (scoreHhUrl > 0) or the
 * site is unreachable (a network/site issue, not our filter). Run before the paid eval.
 * Run: npx tsx scripts/check-discovery-goldens.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { triageSite } from "@/lib/places/siteTriage";
import { scoreHhUrl } from "@/lib/places/hhText";

interface Golden { name: string; url: string; type?: string | null }

async function main() {
  const root = process.cwd();
  const { goldens } = JSON.parse(
    readFileSync(join(root, "eval/extractor-golden.json"), "utf8"),
  ) as { goldens: Golden[] };

  console.log(`\nDiscovery golden check — ${goldens.length} golden(s), $0 (triage only)\n`);
  let failures = 0;

  for (const g of goldens) {
    const verdict = await triageSite({ websiteUri: g.url, name: g.name, cityName: null, primaryType: g.type });
    const signalUrls = verdict.hhSignalUrls.filter((u) => scoreHhUrl(u) > 0);
    const reachable = verdict.reachability === "ok";
    const ok = !reachable || signalUrls.length > 0;
    if (!ok) failures++;

    console.log(`${ok ? "✓" : "✗"} ${g.name}  [${verdict.reachability ?? "—"} / ${verdict.decision}]`);
    console.log(`    HH/menu URLs (${signalUrls.length}/${verdict.hhSignalUrls.length} fetched):`);
    verdict.hhSignalUrls.slice(0, 14).forEach((u) => console.log(`      ${scoreHhUrl(u) > 0 ? "•" : "·"} ${u}`));
    if (!ok) console.log(`    ⚠ reachable but NO HH/menu-signal URL discovered — possible recall regression`);
  }

  console.log(`\n${goldens.length - failures}/${goldens.length} goldens still surface an HH/menu page.`);
  if (failures > 0) {
    console.log("FAIL: a reachable golden lost its HH page — investigate before shipping the discovery change.");
    process.exit(1);
  }
  console.log("PASS: no golden lost discovery of its HH page.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
