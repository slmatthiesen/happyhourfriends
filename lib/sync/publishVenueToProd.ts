import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PublishResult {
  ok: boolean;
  /** true when publishing was skipped because prod isn't configured (local-only dev). */
  skipped?: boolean;
  error?: string;
}

/**
 * Publish one locally-approved venue UP to prod by shelling out to the existing
 * tunnel script (which reads prod credentials via SSM — never from local disk).
 * No-ops cleanly when PROD_INSTANCE_ID is unset so local dev without prod config
 * still works. Only ever runs locally (prod has no /admin), so spawning bash is fine.
 */
export async function publishVenueToProd(
  venueId: string,
  submissionId?: string,
): Promise<PublishResult> {
  if (!process.env.PROD_INSTANCE_ID) return { ok: true, skipped: true };

  const args = ["scripts/publish-venue-to-prod.sh", "--venue", venueId, "--apply"];
  if (submissionId) args.push("--submission", submissionId);

  try {
    await run("bash", args, {
      cwd: process.cwd(),
      env: process.env,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, error: (err.stderr || err.message || "publish failed").trim().slice(0, 500) };
  }
}
