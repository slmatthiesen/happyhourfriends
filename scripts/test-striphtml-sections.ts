/**
 * test-striphtml-sections — guards section-structure preservation in stripHtml.
 * Run: pnpm tsx scripts/test-striphtml-sections.ts  (exits non-zero on any failure)
 *
 * stripHtml used to flatten every tag + whitespace run into ONE line, so the model could
 * not tell which priced items sat under the Happy Hour heading vs a cocktail menu / footer.
 * That mis-attributed offerings (Alcazar, Black Sheep). We now convert headings to "## "
 * markers and block boundaries to newlines so the section signal survives.
 */
import assert from "node:assert/strict";
import { stripHtml } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Mirrors the Alcazar failure: a Signature Cocktails section ABOVE the HH section, plus a
// footer Location line — all of which were collapsed into the HH window before this fix.
const page = `<html><body>
<h2>Signature Cocktails</h2><ul><li>Spanish Gin $17</li><li>Blueberry Mint Lemondrop $17</li></ul>
<h2>Happy Hour 4:30-6pm</h2><ul><li>Heat of Passion $14</li><li>Alcazar Sangria $12</li></ul>
<footer><p>Location: 1812 Cliff Dr</p></footer>
</body></html>`;

check("headings become ## markers", () => {
  const t = stripHtml(page);
  assert.match(t, /## Signature Cocktails/);
  assert.match(t, /## Happy Hour 4:30-6pm/);
});

check("output is multi-line, not one flat run", () => {
  const t = stripHtml(page);
  assert.ok(t.includes("\n"), "expected newlines to survive");
});

check("cocktail-menu items sit BEFORE the HH heading", () => {
  const t = stripHtml(page);
  assert.ok(t.indexOf("Spanish Gin") < t.indexOf("## Happy Hour"), "Spanish Gin leaked past HH heading");
});

check("HH items sit AFTER the HH heading and before the footer Location", () => {
  const t = stripHtml(page);
  const hh = t.indexOf("## Happy Hour");
  assert.ok(t.indexOf("Heat of Passion") > hh, "Heat of Passion not under HH heading");
  assert.ok(t.indexOf("Location") > t.indexOf("Alcazar Sangria"), "footer Location not separated");
});

check("block boundaries without headings still break onto lines (div-soup sites)", () => {
  // Wix/Squarespace render labels as styled divs, not <h2>. Block-boundary breaking must
  // still separate items so "Happy Hour 4-6" sits on its own line as a pseudo-heading.
  const divSoup = `<div>Happy Hour 4-6pm</div><div>Well drinks $6</div><div>Open daily 9am-1pm</div>`;
  const t = stripHtml(divSoup);
  assert.ok(t.includes("\n"), "div boundaries did not break onto lines");
  assert.ok(t.indexOf("Open daily") > t.indexOf("Well drinks"), "lines out of order");
});

check("regression: scripts/styles still dropped, entities still decoded", () => {
  const t = stripHtml(`<html><head><style>.x{}</style></head><body><script>var x=1</script><p>Tacos &amp; Beer</p></body></html>`);
  assert.ok(!/var x=1|\.x\{/.test(t), "script/style leaked");
  assert.match(t, /Tacos & Beer/);
});

check("<br> breaks onto a new line", () => {
  const t = stripHtml(`<p>Tacos $3<br>Beer $4</p>`);
  assert.ok(t.indexOf("Beer") > t.indexOf("Tacos"), "br did not separate lines");
  assert.ok(/Tacos \$3\s*\n\s*Beer \$4/.test(t), "br did not produce a newline between items");
});

check("heading with a '>' inside an attribute value does not leak attr garbage", () => {
  const t = stripHtml(`<h2 data-x="a>b">Happy Hour 4-6pm</h2><p>Well drinks $5</p>`);
  assert.match(t, /## Happy Hour 4-6pm/);
  assert.ok(!/data-x|a>b|class=/.test(t), "attribute garbage leaked into heading");
});

console.log(`\n${passed} checks passed.`);
