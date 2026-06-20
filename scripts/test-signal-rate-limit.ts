/**
 * Runnable unit checks for the signal sliding-window rate limiter (no test
 * framework in repo). Run: npx tsx scripts/test-signal-rate-limit.ts
 */
import assert from "node:assert/strict";
import { evaluateWindow, type RateWindow } from "@/lib/trust/signalRateLimit";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const WINDOWS: RateWindow[] = [
  { windowMs: 60_000, max: 3 },
  { windowMs: 3_600_000, max: 5 },
];

check("first event is allowed and recorded", () => {
  const r = evaluateWindow([], 1000, WINDOWS);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.events, [1000]);
});

check("burst over per-minute max is blocked", () => {
  // 3 events already in the last minute (max 3) → 4th blocked
  const r = evaluateWindow([1000, 2000, 3000], 4000, WINDOWS);
  assert.equal(r.allowed, false);
  // blocked events list is pruned-but-not-appended
  assert.deepEqual(r.events, [1000, 2000, 3000]);
});

check("events older than the largest window are pruned", () => {
  const now = 4_000_000; // > 1h after the old events
  const r = evaluateWindow([1000, 2000], now, WINDOWS);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.events, [now]); // old ones dropped, new appended
});

check("hourly cap blocks even when under the per-minute cap", () => {
  // 5 events spread across the hour (max hourly 5), all > 1min ago → minute count 0
  const events = [0, 100_000, 200_000, 300_000, 400_000];
  const r = evaluateWindow(events, 500_000, WINDOWS);
  assert.equal(r.allowed, false);
});

console.log(`\n${passed} checks passed.`);
