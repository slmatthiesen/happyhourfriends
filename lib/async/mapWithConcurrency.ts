/**
 * Run `worker` over `items` with at most `limit` in flight at once, returning
 * results in original index order.
 *
 * Fail-fast: the first worker rejection stops new items being picked up and the
 * returned promise rejects with that error (in-flight workers settle first). The
 * seed-enrich loop relies on this so a fatal error (e.g. an API quota abort) halts
 * the run with the rest of the candidates left unprocessed for retry — matching the
 * old serial `for` loop's `throw`-aborts-everything behaviour.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  opts: { minSpacingMs?: number } = {},
): Promise<R[]> {
  if (limit < 1) throw new Error(`concurrency limit must be >= 1 (got ${limit})`);

  const results = new Array<R>(items.length);
  let next = 0;
  // A holder object (not a bare `let`) so TS keeps `hit`/`value` honestly typed:
  // control-flow narrowing on a closure-mutated local would collapse it to `never`
  // after the await below.
  const failure: { hit: boolean; err: unknown } = { hit: false, err: undefined };

  // Optional throttle: enforce at least `minSpacingMs` between worker STARTS so a
  // full pool doesn't fire every request at the same instant (which is what ramps
  // an API's per-minute limit into a lockout). Each worker reserves its start slot
  // synchronously, then sleeps until it's due — so the spacing holds without a race.
  const spacing = Math.max(0, opts.minSpacingMs ?? 0);
  let nextStartAt = 0;

  async function runner(): Promise<void> {
    while (!failure.hit) {
      const i = next++;
      if (i >= items.length) return;
      if (spacing > 0) {
        const now = Date.now();
        const wait = Math.max(0, nextStartAt - now);
        nextStartAt = Math.max(now, nextStartAt) + spacing;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        if (!failure.hit) {
          failure.hit = true;
          failure.err = err;
        }
        return;
      }
    }
  }

  const poolSize = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: poolSize }, () => runner()));

  if (failure.hit) throw failure.err;
  return results;
}
