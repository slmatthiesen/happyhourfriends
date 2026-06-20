/**
 * Runnable unit checks for the signal request-body parser.
 * Run: npx tsx scripts/test-signal-request.ts
 */
import assert from "node:assert/strict";
import { parseSignalBody } from "@/lib/trust/signalRequest";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("valid body parses, defaults kind to 'good'", () => {
  const r = parseSignalBody({ venueId: "v1", fingerprint: "fp1" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.body.venueId, "v1");
    assert.equal(r.body.fingerprint, "fp1");
    assert.equal(r.body.kind, "good");
  }
});

check("missing venueId is rejected", () => {
  const r = parseSignalBody({ fingerprint: "fp1" });
  assert.equal(r.ok, false);
});

check("missing fingerprint is rejected", () => {
  const r = parseSignalBody({ venueId: "v1" });
  assert.equal(r.ok, false);
});

check("non-object is rejected", () => {
  assert.equal(parseSignalBody(null).ok, false);
  assert.equal(parseSignalBody("nope").ok, false);
});

check("unknown kind is rejected", () => {
  const r = parseSignalBody({ venueId: "v1", fingerprint: "fp1", kind: "star" });
  assert.equal(r.ok, false);
});

check("honeypot value is preserved", () => {
  const r = parseSignalBody({ venueId: "v1", fingerprint: "fp1", website: "bot" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.body.website, "bot");
});

console.log(`\n${passed} checks passed.`);
