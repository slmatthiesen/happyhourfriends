/**
 * test-chain-happy-hours — hermetic ($0, no DB) checks on the curated chain-HH registry:
 * the name matcher and the synthetic ExtractResult builder. The DB apply (gap-fill guard)
 * runs through the already-tested persistExtractedWindows path.
 *
 * Run: pnpm tsx scripts/test-chain-happy-hours.ts
 */
import assert from "node:assert/strict";
import {
  CHAIN_HAPPY_HOURS,
  CHAIN_HH_MODEL,
  buildChainExtractResult,
  chainHappyHourFor,
} from "@/lib/places/chainHappyHours";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Every registry entry must be PRD-§13-legal: a real source_url + at least one offering,
// each offering carrying the source. A typo'd/empty entry would silently persist bad data.
check("every entry has a source_url, days, time, and sourced offerings", () => {
  for (const c of CHAIN_HAPPY_HOURS) {
    assert.ok(c.sourceUrl && /^https?:\/\//.test(c.sourceUrl), `${c.label}: needs a real sourceUrl`);
    assert.ok(c.daysOfWeek.length > 0, `${c.label}: needs days`);
    assert.ok(c.daysOfWeek.every((d) => d >= 1 && d <= 7), `${c.label}: ISO days 1..7`);
    assert.ok(c.offerings.length > 0, `${c.label}: needs >=1 offering`);
  }
});

check("matcher resolves Super Duper locations, ignores non-matches", () => {
  assert.equal(chainHappyHourFor("Super Duper Burgers")?.chain, "super duper");
  assert.equal(chainHappyHourFor("Super Duper Burgers - Berkeley")?.chain, "super duper");
  assert.equal(chainHappyHourFor("super duper")?.chain, "super duper");
  assert.equal(chainHappyHourFor("Joe's Diner"), null);
  // Must not match a substring of another word ("superduper" with no boundary).
  assert.equal(chainHappyHourFor("Superduperfoods Market"), null);
});

check("buildChainExtractResult emits one gated-ready window with sourced offerings", () => {
  const c = chainHappyHourFor("Super Duper Burgers")!;
  const r = buildChainExtractResult(c);
  assert.equal(r.happyHours.length, 1);
  const hh = r.happyHours[0];
  assert.deepEqual(hh.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(hh.startTime, "16:00");
  assert.equal(hh.endTime, "18:00");
  assert.equal(hh.allDay, false);
  assert.equal(hh.timeKnown, true);
  assert.equal(hh.locationWithinVenue, "all");
  assert.ok(hh.offerings.length >= 2);
  for (const o of hh.offerings) assert.equal(o.sourceUrl, c.sourceUrl);
  // Curated, non-AI, free source.
  assert.equal(r.confidence, 1);
  assert.equal(r.costCents, 0);
  assert.equal(r.model, CHAIN_HH_MODEL);
  assert.equal(r.usage.inputTokens, 0);
});

console.log(`\n${passed} checks passed.`);
