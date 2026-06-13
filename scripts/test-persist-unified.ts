/**
 * test-persist-unified — guards the "ONE persist path" invariant (CLAUDE.md, PRD §4):
 * every extraction-write path MUST funnel happy_hours/offerings + the AI ledger through
 * lib/recover/persistExtractedWindows, so the realness + reconcile + source-provenance
 * gates, soft-delete respect (no resurrecting operator-deleted windows), offering
 * sanity/dedup, and audit logging can never silently diverge between paths.
 *
 * This is a hermetic STATIC guard (reads source, no DB) — a one-shot live-DB "golden"
 * would be tautological now that the window-persist is literally shared code, and it
 * couldn't run in CI anyway. The shared path's gate logic is unit-tested separately
 * (test:window-reconcile, test:realness-gate, test:source-provenance, test:offering-sanity).
 *
 * It exists because seed:enrich USED to carry its own forked persist that skipped those
 * gates (and could resurrect deleted windows). This test fails loudly if any path grows
 * a second window/offering/ledger INSERT instead of delegating.
 *
 * Run: pnpm tsx scripts/test-persist-unified.ts  (exits non-zero on any failure)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every script that writes extracted HH data. Each MUST delegate to the shared path and
// MUST NOT hand-roll a happy_hours / offerings / ai_usage_ledger INSERT of its own.
const DELEGATING_WRITERS = [
  "scripts/seed-enrich-candidates.ts",
  "scripts/reextract-stubs.ts",
];

// A raw INSERT into any of these tables is the forbidden fork — the canonical
// persistExtractedWindows is the only place allowed to write them.
const FORBIDDEN_INSERT = /insert\s+into\s+(happy_hours|offerings|ai_usage_ledger)\b/i;
// drizzle-style insert, e.g. db.insert(happyHours) / .insert(offerings).
const FORBIDDEN_DRIZZLE = /\.insert\(\s*(happyHours|offerings|aiUsageLedger)\b/;

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

for (const rel of DELEGATING_WRITERS) {
  const src = readFileSync(join(root, rel), "utf8");

  check(`${rel} delegates to persistExtractedWindows`, () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bpersistExtractedWindows\b[^}]*\}\s*from\s*["']@\/lib\/recover\/resolveVenue["']/,
      "must import persistExtractedWindows from the canonical persist path",
    );
    assert.match(src, /\bpersistExtractedWindows\s*\(/, "must actually call persistExtractedWindows");
  });

  check(`${rel} has no forked happy_hours/offerings/ledger INSERT`, () => {
    assert.doesNotMatch(
      src,
      FORBIDDEN_INSERT,
      "found a raw INSERT INTO happy_hours/offerings/ai_usage_ledger — write paths must funnel through persistExtractedWindows, not fork it",
    );
    assert.doesNotMatch(
      src,
      FORBIDDEN_DRIZZLE,
      "found a drizzle .insert(happyHours/offerings/aiUsageLedger) — write paths must funnel through persistExtractedWindows, not fork it",
    );
  });
}

// Sanity: the canonical path is the ONE place that legitimately owns those INSERTs, so it
// should still contain them — otherwise the regex above is matching nothing meaningful.
check("lib/recover/resolveVenue.ts owns the canonical INSERTs", () => {
  const canonical = readFileSync(join(root, "lib/recover/resolveVenue.ts"), "utf8");
  assert.match(canonical, FORBIDDEN_DRIZZLE, "the canonical persist path should contain the happy_hours/offerings/ledger inserts");
});

console.log(`\n${passed} checks passed.`);
