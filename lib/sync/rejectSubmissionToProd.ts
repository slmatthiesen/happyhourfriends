import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface RejectResult {
  ok: boolean;
  /** true when the push was skipped because prod isn't configured (local-only dev). */
  skipped?: boolean;
  error?: string;
}

/**
 * Propagate a local /admin rejection UP to prod (flip its edit_submissions row to
 * 'rejected') by shelling out to the tunnel script, which reads prod credentials via SSM —
 * never from local disk. Mirrors publishVenueToProd: no-ops cleanly when PROD_INSTANCE_ID is
 * unset so local dev without prod config still works. Without it, prod keeps the row
 * queued_admin and it reappears on every pull:queue. Only ever runs locally (prod has no
 * /admin), so spawning bash is fine.
 */
export async function rejectSubmissionToProd(submissionId: string): Promise<RejectResult> {
  if (!process.env.PROD_INSTANCE_ID) return { ok: true, skipped: true };

  try {
    await run("bash", ["scripts/reject-submission-on-prod.sh", "--submission", submissionId, "--apply"], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, error: (err.stderr || err.message || "reject-to-prod failed").trim().slice(0, 500) };
  }
}
