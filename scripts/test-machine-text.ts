/**
 * Unit tests for looksLikeMachineText (lib/ai/siteContent) — the render-escalation
 * trigger for JS-walled pages whose stripped "text" is machine payload. Calibrated
 * against the 2026-06-10 real cases: calascottsdale.com route-slug soup (JUNK) vs
 * eatwoven.com / backyardspokane.com menu prose (prose). Pure logic, no network.
 */
import assert from "node:assert/strict";
import { looksLikeMachineText, isStaleDatedDocPath } from "@/lib/ai/siteContent";

let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// Route-slug soup (the Cala pattern): slash-heavy path dumps.
const SLUG_SOUP = Array.from(
  { length: 60 },
  (_, i) => `/happy-hour/81a55298-6437-40a1-adaa-${i}/49b58673-51f7-40b7 · /dinner/build-your-menu`,
).join(" · ");
assert.equal(looksLikeMachineText(SLUG_SOUP), true);
check("route-slug soup → machine text (Cala pattern)");

// Telemetry/JSON config (the order.online pattern).
const JSON_CONFIG = JSON.stringify({
  config: Array.from({ length: 50 }, (_, i) => ({ key: `feature_flag_${i}`, value: i % 2 === 0, ts: 1718000000 + i })),
});
assert.equal(looksLikeMachineText(JSON_CONFIG), true);
check("JSON config payload → machine text");

// Real menu prose stays prose.
const MENU_PROSE = `
Join us for happy hour specials 1-5pm Monday through Friday. Enjoy half priced select
appetizers, one dollar off all draft beers and ciders, five dollar wells, and ten dollar
shareables. Our kitchen serves wood-fired pizzas, fresh oysters on the half shell with
house-made mignonette, and the best burgers in the neighborhood. Reservations recommended
on weekends. We look forward to seeing you on the patio — weather permitting, live music
every Sunday afternoon after brunch service wraps up at two.
`.repeat(2);
assert.equal(looksLikeMachineText(MENU_PROSE), false);
check("menu prose → not machine text");

// Short texts are never judged junk (the empty-check path owns them).
assert.equal(looksLikeMachineText("/a/b/c={};"), false);
check("sub-200-char text never flags");

// ── isStaleDatedDocPath (The Monica stale-PNG pattern, 2026-06-11) ──────────
const NOW = new Date("2026-06-11T12:00:00Z");
assert.equal(isStaleDatedDocPath("https://themonicatucson.com/wp-content/uploads/2022/08/happyhour-2-6.png", NOW), true);
check("2022 uploads path → stale doc");
assert.equal(isStaleDatedDocPath("https://x.com/wp-content/uploads/2025/11/menu.pdf", NOW), false);
check("recent-year path → not stale");
assert.equal(isStaleDatedDocPath("https://x.com/_files/ugd/abc123.pdf", NOW), false);
check("no year token → never stale (Bottega Wix paths unaffected)");
assert.equal(isStaleDatedDocPath("https://x.com/uploads/2019/menu-2026.png", NOW), false);
check("a current-year token anywhere in the path rescues an old dir");

console.log(`\n✓ ${passed} machine-text assertions passed.`);
