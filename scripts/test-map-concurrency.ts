/**
 * Unit tests for mapWithConcurrency (lib/async/mapWithConcurrency) — the bounded
 * worker pool that lets the seed-enrich loop process candidates in parallel without
 * exceeding a connection/rate ceiling. Pure logic, no network/DB.
 *
 * Behaviour contract:
 *  - runs every item, results land in ORIGINAL index order
 *  - never more than `limit` workers in flight at once
 *  - fail-fast: the first worker error stops new work being picked up and rejects
 *    (this is what preserves the enrich loop's quota-abort semantics)
 */
import assert from "node:assert/strict";
import { mapWithConcurrency } from "@/lib/async/mapWithConcurrency";

let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const tick = () => new Promise((r) => setTimeout(r, 5));

async function main() {
  // 1. Maps all items, results in original order regardless of completion order.
  {
    const items = [1, 2, 3, 4, 5];
    const out = await mapWithConcurrency(items, 2, async (n) => {
      // Make later items finish sooner to scramble completion order.
      await new Promise((r) => setTimeout(r, (10 - n) * 3));
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    check("maps every item, results in original index order");
  }

  // 2. Never exceeds the concurrency limit.
  {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight--;
      return n;
    });
    assert.ok(maxInFlight <= 4, `maxInFlight=${maxInFlight} should be <= 4`);
    assert.ok(maxInFlight >= 2, `pool should actually parallelize (saw ${maxInFlight})`);
    check("respects the concurrency ceiling");
  }

  // 3. Fail-fast: first error rejects and stops picking up new work.
  {
    let started = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);
    await assert.rejects(
      mapWithConcurrency(items, 3, async (n) => {
        started++;
        await tick();
        if (n === 1) throw new Error("boom");
        return n;
      }),
      /boom/,
    );
    // With a ceiling of 3 and an early throw, we must NOT have started all 50.
    assert.ok(started < items.length, `started=${started} should be < ${items.length}`);
    check("fail-fast: first error rejects and halts new work");
  }

  // 3b. minSpacingMs throttles worker STARTS (rate-limit guard).
  {
    const starts: number[] = [];
    const t0 = Date.now();
    await mapWithConcurrency(
      [0, 1, 2, 3, 4],
      5, // full pool — without spacing all 5 would start at ~t0
      async () => {
        starts.push(Date.now() - t0);
        await tick();
      },
      { minSpacingMs: 20 },
    );
    // 5 starts spaced ~20ms apart → last start is ~80ms in, not ~0.
    const lastStart = Math.max(...starts);
    assert.ok(lastStart >= 60, `last worker should start >=60ms in, saw ${lastStart}ms`);
    check("minSpacingMs spaces out worker starts");
  }

  // 4. Guards an invalid limit.
  {
    await assert.rejects(mapWithConcurrency([1], 0, async (n) => n), /limit/);
    check("rejects a concurrency limit < 1");
  }

  // 5. Empty input → empty output, no workers run.
  {
    let ran = false;
    const out = await mapWithConcurrency([], 4, async () => {
      ran = true;
      return 1;
    });
    assert.deepEqual(out, []);
    assert.equal(ran, false);
    check("empty input → empty output");
  }

  console.log(`\n✓ mapWithConcurrency: ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
