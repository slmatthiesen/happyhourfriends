/**
 * Unit checks for harvestMenuJson — pull menu sections (title + item name/price) out of the
 * inline JSON that JS frameworks (Next.js RSC, Squarespace) embed in the page, so the deals reach
 * the model. No network ($0). Run: pnpm tsx scripts/test-menu-json.ts
 *
 * Why: Twelvemonth (Burlingame) renders its menus — including Happy Hour — as ESCAPED JSON in a
 * <script> (self.__next_f), shown client-side via tabs. innerText sees only the visible tab and
 * stripHtml drops <script>, so the HH deals never reach the model → a bare window.
 */
import assert from "node:assert/strict";
import { harvestMenuJson } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// Real shape from Twelvemonth's rendered HTML: escaped (\") JSON inside a Next.js flight chunk.
const twelvemonth =
  'x<script>self.__next_f.push([1,"...wines.\\",\\"sections\\":[' +
  '{\\"title\\":\\"Happy Hour\\",\\"items\\":[' +
  '{\\"name\\":\\"ALL SPECIALTY COCKTAILS\\",\\"description\\":\\"$undefined\\",\\"price\\":\\"$$15\\",\\"gf\\":false},' +
  '{\\"name\\":\\"CHARDONNAY\\",\\"description\\":\\"post&beam far niente\\",\\"price\\":\\"$17\\"}]},' +
  '{\\"title\\":\\"Small Plates\\",\\"items\\":[' +
  '{\\"name\\":\\"Olives\\",\\"description\\":\\"$undefined\\",\\"price\\":\\"$9\\"}]}]"])</script>';

check("extracts the Happy Hour section's item names + prices", () => {
  const out = harvestMenuJson(twelvemonth);
  assert.match(out, /Happy Hour/);
  assert.match(out, /ALL SPECIALTY COCKTAILS/);
  assert.match(out, /CHARDONNAY/);
  assert.match(out, /\$17/);
});

check("collapses the $$ template artifact to a single $", () => {
  assert.match(harvestMenuJson(twelvemonth), /\$15/);
  assert.doesNotMatch(harvestMenuJson(twelvemonth), /\$\$15/);
});

check("keeps section grouping — the title precedes its items", () => {
  const out = harvestMenuJson(twelvemonth);
  assert.ok(out.indexOf("Happy Hour") < out.indexOf("ALL SPECIALTY COCKTAILS"), "HH title before its items");
  assert.ok(out.indexOf("CHARDONNAY") < out.indexOf("Small Plates"), "HH items before the next section");
});

check("also captures the other sections (model scopes to HH; we don't pre-filter)", () =>
  assert.match(harvestMenuJson(twelvemonth), /Small Plates[\s\S]*Olives/));

check("works on UN-escaped JSON too (SSR'd, not flight-encoded)", () => {
  const ssr = '<div>{"sections":[{"title":"Happy Hour","items":[{"name":"Draft Beer","price":"$5"}]}]}</div>';
  assert.match(harvestMenuJson(ssr), /Happy Hour[\s\S]*Draft Beer[\s\S]*\$5/);
});

check("decodes \\uXXXX escapes in names (flight JSON encodes & as \\u0026)", () => {
  const h = '<script>"sections":[{"title":"Bar","items":[{"name":"SEMILLON \\u0026 S. BLANC","price":"$23"}]}]</script>';
  const out = harvestMenuJson(h);
  assert.match(out, /SEMILLON & S\. BLANC/);
  assert.doesNotMatch(out, /u0026/);
});

check("no menu JSON → empty string (never invents content)", () => {
  assert.equal(harvestMenuJson("<p>Happy hour daily 4-6pm, call for details.</p>"), "");
  assert.equal(harvestMenuJson('{"user":{"name":"bob"}}'), ""); // name without an items/price menu
});

console.log(`\n✓ ${passed} menu-json checks passed.`);
