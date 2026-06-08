/**
 * Runnable check: normalizeUrl accepts bare domains (the bug: forms used type="url"
 * so "www.somesite.com" was rejected until you typed https://), prepends https, and
 * rejects junk.
 *
 * Run: tsx scripts/test-normalize-url.ts
 */
import assert from "node:assert";
import { normalizeUrl } from "@/lib/submit/normalizeUrl";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("prepends https:// to a bare domain (the reported bug)", () => {
  assert.equal(normalizeUrl("www.somesite.com"), "https://www.somesite.com/");
  assert.equal(normalizeUrl("somesite.com"), "https://somesite.com/");
  assert.equal(normalizeUrl("somesite.com/menu"), "https://somesite.com/menu");
});

check("keeps an explicit scheme intact", () => {
  assert.equal(normalizeUrl("https://x.com/happy-hour"), "https://x.com/happy-hour");
  assert.equal(normalizeUrl("http://x.com"), "http://x.com/");
});

check("trims whitespace", () => {
  assert.equal(normalizeUrl("  www.x.com  "), "https://www.x.com/");
});

check("empty / blank → null", () => {
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("   "), null);
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl(undefined), null);
});

check("rejects non-web input", () => {
  assert.equal(normalizeUrl("not a url at all"), null, "spaces → invalid");
  assert.equal(normalizeUrl("foo"), null, "no dot in host");
  assert.equal(normalizeUrl("localhost"), null, "no dot in host");
  assert.equal(normalizeUrl("mailto:a@b.com"), null, "non-http scheme");
  assert.equal(normalizeUrl("javascript:alert(1)"), null, "no // scheme → https://javascript:… invalid");
});

console.log(`\n${passed} checks passed.`);
