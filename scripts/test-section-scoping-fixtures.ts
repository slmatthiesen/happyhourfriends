/**
 * test-section-scoping-fixtures — deterministic ($0) golden over real pages the extractor
 * mis-scoped. Asserts stripHtml now SEPARATES the happy-hour section from the surrounding
 * cocktail menu / footer / other-section content, and that the real HH items survive
 * (the over-stripping guard). Model keep/drop behavior is validated separately by the live
 * 3-venue re-extract (see docs/superpowers/plans/2026-06-17-extractor-section-scoping.md,
 * Task 4) — this test proves the ENABLER (the section signal reaches the model), at $0.
 *
 * Fixtures captured 2026-06-17 via plain-HTTP GET with our bot UA. NOTE: the static HTML of
 * Alcazar's HH page does NOT contain the $17 signature cocktails or the $40 bottle (those
 * are JS-rendered — which is how the enrich pass captured them); and Black Sheep's
 * /happyhour-menu has NO $55 brunch/moules (those leaked from the homepage). So those
 * precision cases are validated by the live re-extract, not assertable on these fixtures.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripHtml } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const lines = (f: string) =>
  stripHtml(readFileSync(`scripts/fixtures/section-scoping/${f}`, "utf8")).split("\n");
const lastIndex = (ls: string[], re: RegExp) =>
  ls.reduce((acc, l, i) => (re.test(l) ? i : acc), -1);

check("structure survives — fixtures are multi-line, not one flat run", () => {
  for (const f of ["alcazar.html", "black-sheep.html", "state-street.html"]) {
    assert.ok(lines(f).length > 20, `${f} collapsed to ${lines(f).length} lines`);
  }
});

check("alcazar: real HH items sit under the Happy Hour heading (recall guard)", () => {
  const ls = lines("alcazar.html");
  const hh = lastIndex(ls, /happy hour 4:30-6/i);
  assert.ok(hh >= 0, "HH heading line not found");
  const section = ls.slice(hh, hh + 5).join(" ");
  assert.match(section, /Heat of Passion \$14/);
  assert.match(section, /Alcazar Sangria \$12/);
  assert.match(section, /House Red \$13/);
});

check("black-sheep: HH page carries the $41 prix-fixe + a 5-6pm window, no homepage brunch", () => {
  const ls = lines("black-sheep.html");
  const joined = ls.join("\n");
  assert.match(joined, /41/); // Happy Hour Prix Fixe 3 Courses $41
  assert.ok(/5\s*[-–]\s*6|5\s*pm/i.test(joined), "no 5-6pm window text");
  // The $55 brunch / "moules frites" came from the homepage, NOT this HH page — confirm
  // re-extracting from this URL cannot reintroduce them.
  assert.ok(!/moules/i.test(joined), "unexpected 'moules' on the HH page");
  assert.ok(!/\$55|55\s+(brunch|moules)/i.test(joined), "unexpected $55 on the HH page");
});

check("state-street: $1-off pints + 3-5pm sit under HAPPY HOUR, separate from the $15 bottle line", () => {
  const ls = lines("state-street.html");
  const hh = lastIndex(ls, /happy hour/i);
  assert.ok(hh >= 0, "HH heading not found");
  const section = ls.slice(hh, hh + 6).join("\n");
  assert.match(section, /1 off PINTS/i);
  assert.ok(/3\s*-\s*5pm/i.test(section), "HH schedule 3-5pm not under the HH heading");
  // The "$15 ... bottle" deal must NOT share the $1-off-pints line (it's a separate section).
  const pintsLine = ls.find((l) => /1 off PINTS/i.test(l)) ?? "";
  assert.ok(!/15/.test(pintsLine), `"$15 bottle" leaked onto the pints line: "${pintsLine}"`);
});

console.log(`\n${passed} checks passed.`);
