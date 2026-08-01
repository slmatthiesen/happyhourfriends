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
  chainHappyHoursFor,
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

check("a multi-window chain returns EVERY window, not just the first", () => {
  // Pacific Catch publishes a weekday and a weekend Aloha Hour with different end times.
  // chainHappyHourFor returns only the first, so the applier must use chainHappyHoursFor —
  // otherwise every location silently loses its weekend window.
  const all = chainHappyHoursFor("Pacific Catch");
  assert.equal(all.length, 2, "expected both Aloha Hour windows");
  const weekday = all.find((c) => c.daysOfWeek.length === 5)!;
  const weekend = all.find((c) => c.daysOfWeek.length === 2)!;
  assert.deepEqual(weekday.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(weekday.startTime, "15:00");
  assert.equal(weekday.endTime, "18:00");
  assert.deepEqual(weekend.daysOfWeek, [6, 7]);
  assert.equal(weekend.startTime, "15:00");
  assert.equal(weekend.endTime, "17:00");
  // Matches real location names, not just the bare chain key.
  assert.equal(chainHappyHoursFor("Pacific Catch - Chestnut St").length, 2);
  assert.equal(chainHappyHoursFor("Pacific Cafe").length, 0);
});

check("single-window chains still return exactly one match", () => {
  assert.equal(chainHappyHoursFor("Super Duper Burgers").length, 1);
  assert.equal(chainHappyHoursFor("Joe's Diner").length, 0);
});

console.log(`\n${passed} checks passed.`);
