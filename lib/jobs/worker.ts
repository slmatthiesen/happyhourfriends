import { getBoss } from "./boss";
import { handleClassify } from "./handlers/classify";
import { handleVerify } from "./handlers/verify";
import { handleResolveFlags } from "./handlers/resolveFlags";
import { handleDetectAnomalies } from "./handlers/anomaly";
import { handleReverify } from "./handlers/reverify";
import { QUEUES, type ClassifyJobData, type VerifyJobData } from "./queue";

/**
 * Register all job handlers + scheduled maintenance. Booted once from
 * instrumentation.ts at server startup (long-running node process / DO droplet).
 * Cron handlers no-op gracefully when there's nothing to do or no API key.
 */
let started = false;

const CRON = {
  flags: "resolve-flags",
  anomaly: "detect-anomalies",
  reverify: "reverify-venues",
} as const;

export async function startWorkers(): Promise<void> {
  if (started) return;
  started = true;
  const boss = await getBoss();

  // ── Pipeline queues ──────────────────────────────────────────────────────
  await boss.createQueue(QUEUES.classify);
  await boss.work<ClassifyJobData>(QUEUES.classify, async (jobs) => {
    for (const job of jobs) await handleClassify(job.data.submissionId);
  });

  await boss.createQueue(QUEUES.verify);
  await boss.work<VerifyJobData>(QUEUES.verify, async (jobs) => {
    for (const job of jobs) await handleVerify(job.data.submissionId);
  });

  // ── Scheduled maintenance (PRD §5.1 item 6, §5.3, §7) ────────────────────
  await boss.createQueue(CRON.flags);
  await boss.work(CRON.flags, async () => handleResolveFlags());
  await boss.schedule(CRON.flags, "0 8 * * *"); // daily 08:00 UTC

  await boss.createQueue(CRON.anomaly);
  await boss.work(CRON.anomaly, async () => handleDetectAnomalies());
  await boss.schedule(CRON.anomaly, "0 9 * * 1"); // weekly Mon 09:00 UTC

  await boss.createQueue(CRON.reverify);
  await boss.work(CRON.reverify, async () => handleReverify());
  await boss.schedule(CRON.reverify, "0 7 * * *"); // daily 07:00 UTC
}
