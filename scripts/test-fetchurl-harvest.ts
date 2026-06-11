/**
 * Runnable unit checks for harvestScriptText (no test framework in repo).
 * Run: pnpm tsx scripts/test-fetchurl-harvest.ts — exits non-zero on any failure.
 *
 * Guards the fix for SSR/JS sites that hide happy-hour text inside <script> JSON, which
 * stripHtml drops wholesale (Philly's Sports Grill: visible text 0 chars, HH in a
 * dashtrack config blob; Side Pony: Wix warmup-data).
 */
import assert from "node:assert/strict";
import { harvestScriptText } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Philly's: dashtrack config, unicode-escaped <p> + &amp; entities, HH in a "notes" value.
const philly = `
<html><body><div id="app"></div>
<script type='text/javascript'>
  document.addEventListener('DOMContentLoaded', dashtrack.bootstrapApp({
    apiKey:'85abc', locations:[{"name":"Scottsdale","notes":"\\u003cp\\u003eHappy Hour: 3pm-7pm daily \\u0026amp; 11pm-2am Sunday through Thursday\\u003c/p\\u003e","phone":"+14809466666"}]
  }));
</script>
</body></html>`;

check("recovers HH from dashtrack <script> JSON (notes field)", () => {
  const t = harvestScriptText(philly);
  assert.match(t, /Happy Hour: 3pm-7pm daily/i);
});
check("decodes unicode-escaped tags + entities (no raw \\u003c or &amp;)", () => {
  const t = harvestScriptText(philly);
  assert.ok(!/\\u003c/i.test(t), "left raw \\u003c");
  assert.ok(!/<p>|&amp;/i.test(t), "left raw tag/entity");
  assert.match(t, /11pm-2am Sunday through Thursday/i);
});

// Wix warmup-data style: rich-text spans embedded as JSON string values.
const wix = `
<script type="application/json" id="wix-warmup-data">
{"a":{"text":"Tacoma's Best Happy Hour"},"b":{"text":"Runs from 3/4pm-6pm and 9pm-Close"},"c":{"text":"$1 off menu cocktails, draft beer"}}
</script>`;

check("recovers HH text from Wix warmup-data JSON", () => {
  const t = harvestScriptText(wix);
  assert.match(t, /Best Happy Hour/i);
  assert.match(t, /3\/4pm-6pm/i);
});

check("skips bare tokens / keys / ids (no menu signal)", () => {
  const t = harvestScriptText(`<script>var x={"id":"abc123","slug":"home","apiKey":"k_9f8a7"}</script>`);
  assert.equal(t, "");
});

// Wix echoes the request's User-Agent into warmup JSON; our bot name contains
// "HappyHour" and was false-firing the HH-signal gate + scan-hh-signal on zero-HH
// pages (Blast & Brew Pismo, Blast 825, Bistro 4293 — all labeled "REAL MISS").
check("skips strings echoing our own bot UA (Wix userAgent echo)", () => {
  const t = harvestScriptText(
    `<script>{"deviceInfo":{"appVersion":"2.5033.0","userAgent":"HappyHourFriendsBot/1.0 (+https://happyhourfriends.com)"},"b":{"text":"Open daily 11am"}}</script>`,
  );
  assert.ok(!/HappyHourFriendsBot/.test(t), "harvested our own UA echo");
  assert.match(t, /Open daily 11am/i);
});

check("ignores external <script src> bundles (no inline body mined)", () => {
  const t = harvestScriptText(`<script src="https://cdn/lodash.js">"Happy Hour 4-6pm"</script>`);
  // The body of a src= script is not real page content; must not be harvested.
  assert.equal(t, "");
});

check("returns empty for a page with no script JSON", () => {
  assert.equal(harvestScriptText(`<html><body><p>Welcome</p></body></html>`), "");
});

check("respects the cap (bounded output)", () => {
  const many = Array.from({ length: 500 }, (_, i) => `{"text":"Happy Hour deal ${i} at 4pm-6pm"}`).join(",");
  const t = harvestScriptText(`<script>[${many}]</script>`, 1000);
  assert.ok(t.length <= 1200, `expected ~<=1000, got ${t.length}`);
});

console.log(`\n${passed} checks passed.`);
