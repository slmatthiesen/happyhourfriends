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
