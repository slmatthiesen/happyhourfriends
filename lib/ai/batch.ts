/**
 * Thin wrappers over the Anthropic Message Batches API for the seed-enrichment
 * batch path. Each request is a single-shot extraction (see lib/ai/extractHappyHours).
 */
import type {
  MessageBatch,
  MessageBatchIndividualResponse,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";

import { batchAnthropic } from "@/lib/ai/anthropic";

export interface BatchRequest {
  custom_id: string;
  params: MessageCreateParamsNonStreaming;
}

/**
 * The inline `batches.create({ requests: [...] })` endpoint rejects (413 request_too_large)
 * any POST body over 50 MB — the server returns "Maximum size is 52428800 bytes". (The
 * documented 256 MB limit applies only to the separate file-upload batch flow, which we
 * don't use.) Our requests inline page HTML + base64 PDF/image bytes, so a media-heavy city
 * can blow the cap. Pack chunks to ~45 MB to leave headroom for the `{"requests":[…]}`
 * wrapper and transport overhead under the hard 50 MB limit.
 */
export const MAX_BATCH_REQUEST_BYTES = 45 * 1024 * 1024;

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
  const batch = await batchAnthropic().messages.batches.create({ requests });
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
    const batch = await batchAnthropic().messages.batches.retrieve(id);
    opts?.onTick?.(batch);
    if (batch.processing_status === "ended") return batch;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Async-iterate the per-request results once the batch has ended. */
export async function* streamResults(
  id: string,
): AsyncGenerator<MessageBatchIndividualResponse> {
  for await (const result of await batchAnthropic().messages.batches.results(id)) {
    yield result;
  }
}
