import { getBoss } from "./boss";

/** Queue names. Keep in one place so producer and worker can't drift. */
export const QUEUES = {
  classify: "classify-submission",
  verify: "verify-submission",
} as const;

export interface ClassifyJobData {
  submissionId: string;
}

export interface VerifyJobData {
  submissionId: string;
}

/**
 * Enqueue a Stage 1 classification for a submission. Ensures the queue exists first
 * (idempotent) so a send never races the worker's queue creation on cold start.
 * Callers should treat failures as non-fatal — the submission is already persisted
 * and visible in the admin queue even if classification never runs.
 */
export async function enqueueClassify(submissionId: string): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(QUEUES.classify);
  await boss.send(QUEUES.classify, { submissionId } satisfies ClassifyJobData);
}

/** Enqueue a Stage 2 verification (PRD §4.3). Same non-fatal contract as classify. */
export async function enqueueVerify(submissionId: string): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(QUEUES.verify);
  await boss.send(QUEUES.verify, { submissionId } satisfies VerifyJobData);
}
