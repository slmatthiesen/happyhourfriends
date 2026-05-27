import { resolveOpenFlags } from "@/lib/trust/flagResolution";

/**
 * Daily community-flag resolution (PRD §3.10, §5.3). Tallies distinct-fingerprint
 * votes and stamps confirmed/rejected/expired resolutions.
 *
 * TODO (PRD §3.10): on a `confirmed` discontinuation/closure, apply the implied
 * venue change + notify admin; on `rejected`, decrement the originating submitter's
 * trust. Both need a flag→submission/actor linkage that isn't modelled yet.
 */
export async function handleResolveFlags(): Promise<void> {
  try {
    const decided = await resolveOpenFlags();
    const acted = decided.filter((d) => d.decision !== "pending");
    if (acted.length) {
      console.log(`[cron] resolved ${acted.length} flag group(s)`, acted);
    }
  } catch (e) {
    console.error("[cron] resolveOpenFlags failed", e);
  }
}
