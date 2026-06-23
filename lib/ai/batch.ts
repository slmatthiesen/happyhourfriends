/**
 * Thin wrappers over the Anthropic Message Batches API for the seed-enrichment
 * batch path. Each request is a single-shot extraction (see lib/ai/extractHappyHours).
 */
import type {
  MessageBatch,
  MessageBatchIndividualResponse,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";

import { anthropic } from "@/lib/ai/anthropic";

export interface BatchRequest {
  custom_id: string;
  params: MessageCreateParamsNonStreaming;
}

/**
 * The Message Batches API rejects (413 request_too_large) any create() whose HTTP body
 * exceeds 256MB. Our requests inline page HTML + base64 PDF/image bytes, so a media-heavy
 * city (San Jose: 246 gated requests) can blow the cap. Pack chunks to ~200MB to leave
 * headroom for JSON framing and transport overhead under the hard limit.
 */
export const MAX_BATCH_REQUEST_BYTES = 200 * 1024 * 1024;

/**
 * Greedily pack requests into chunks whose serialized size stays under `maxBytes`, preserving
 * order. A single request that alone exceeds the budget is isolated in its own chunk rather than
 * dropped — createBatch may still reject that one, but it never poisons its siblings.
 */
export function chunkRequestsBySize(
  requests: BatchRequest[],
  maxBytes: number = MAX_BATCH_REQUEST_BYTES,
): BatchRequest[][] {
  const chunks: BatchRequest[][] = [];
  let current: BatchRequest[] = [];
  let currentBytes = 0;
  for (const req of requests) {
    const size = Buffer.byteLength(JSON.stringify(req));
    if (current.length > 0 && currentBytes + size > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(req);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Submit a batch; returns the batch id. */
export async function createBatch(requests: BatchRequest[]): Promise<string> {
  const batch = await anthropic().messages.batches.create({ requests });
  return batch.id;
}

/**
 * Poll until the batch finishes (processing_status === "ended"). Logs progress
 * each tick. Default 300s — local single-venue extraction alone can exceed 60s,
 * so tighter polling buys nothing for a job that can take hours.
 */
export async function pollBatch(
  id: string,
  opts?: { intervalMs?: number; onTick?: (b: MessageBatch) => void },
): Promise<MessageBatch> {
  const intervalMs = opts?.intervalMs ?? 300_000;
  for (;;) {
    const batch = await anthropic().messages.batches.retrieve(id);
    opts?.onTick?.(batch);
    if (batch.processing_status === "ended") return batch;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Async-iterate the per-request results once the batch has ended. */
export async function* streamResults(
  id: string,
): AsyncGenerator<MessageBatchIndividualResponse> {
  for await (const result of await anthropic().messages.batches.results(id)) {
    yield result;
  }
}
