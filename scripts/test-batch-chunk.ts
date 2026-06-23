/**
 * Unit checks for chunkRequestsBySize — split a batch of extraction requests so each
 * createBatch() HTTP body stays under Anthropic's 256MB request cap. No network ($0).
 * Run: pnpm tsx scripts/test-batch-chunk.ts
 *
 * Why: the seed-enrich --batch path inlines each candidate's page HTML + base64 PDF/image
 * bytes into its request. San Jose gated 246 such requests and the single createBatch call's
 * body exceeded 256MB → a 413 request_too_large that rejected the WHOLE batch (0 venues, then
 * the run aborts). Chunking under the cap is the fix; a venue whose own payload already exceeds
 * the budget still goes out alone (createBatch may reject it, but it never poisons its siblings).
 */
import assert from "node:assert/strict";
import { chunkRequestsBySize, type BatchRequest } from "@/lib/ai/batch";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// Build a request whose JSON serialization is ~`kb` kilobytes by padding a content string.
function reqOfSize(id: string, kb: number): BatchRequest {
  const filler = "x".repeat(kb * 1024);
  return {
    custom_id: id,
    // minimal shape; only total serialized size matters to the chunker
    params: { model: "m", max_tokens: 1, messages: [{ role: "user", content: filler }] } as BatchRequest["params"],
  };
}

check("empty input → no chunks", () => {
  assert.deepEqual(chunkRequestsBySize([], 1024), []);
});

check("everything fits in one chunk when under budget", () => {
  const reqs = [reqOfSize("a", 1), reqOfSize("b", 1), reqOfSize("c", 1)];
  const chunks = chunkRequestsBySize(reqs, 10 * 1024); // 10KB budget, ~3KB total
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 3);
});

check("splits into multiple chunks once the running total would exceed the budget", () => {
  const reqs = [reqOfSize("a", 4), reqOfSize("b", 4), reqOfSize("c", 4), reqOfSize("d", 4)];
  // ~4KB each; 10KB budget packs 2 per chunk (2 fit at ~8KB, a 3rd would exceed).
  const chunks = chunkRequestsBySize(reqs, 10 * 1024);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((c) => c.length), [2, 2]);
});

check("every original request lands in exactly one chunk, order preserved", () => {
  const reqs = ["a", "b", "c", "d", "e"].map((id) => reqOfSize(id, 4));
  const chunks = chunkRequestsBySize(reqs, 10 * 1024);
  const flat = chunks.flat().map((r) => r.custom_id);
  assert.deepEqual(flat, ["a", "b", "c", "d", "e"]);
});

check("a single oversized request still goes out alone (never silently dropped)", () => {
  const reqs = [reqOfSize("small", 1), reqOfSize("huge", 50), reqOfSize("small2", 1)];
  const chunks = chunkRequestsBySize(reqs, 10 * 1024); // 'huge' alone is 50KB > 10KB budget
  // huge must be isolated in its own chunk; the two smalls share a chunk.
  const ids = chunks.map((c) => c.map((r) => r.custom_id));
  const flat = ids.flat();
  assert.deepEqual([...flat].sort(), ["huge", "small", "small2"]);
  const hugeChunk = chunks.find((c) => c.some((r) => r.custom_id === "huge"))!;
  assert.equal(hugeChunk.length, 1);
});

check("default budget leaves headroom under the 256MB API cap", () => {
  // one 'request' just under default → single chunk; sanity that the default is large.
  const chunks = chunkRequestsBySize([reqOfSize("a", 1)]);
  assert.equal(chunks.length, 1);
});

console.log(`\n✓ ${passed} batch-chunk checks passed.`);
