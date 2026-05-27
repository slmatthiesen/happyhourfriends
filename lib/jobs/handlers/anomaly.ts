import { detectCrossVenueAnomalies } from "@/lib/trust/anomaly";

/**
 * Weekly cross-venue anomaly sweep (PRD §5.1 item 6): /24 IP blocks pushing many
 * critical-risk changes to distinct venues. Surfaced to logs for manual operator
 * review (email wiring lands with Resend setup).
 */
export async function handleDetectAnomalies(): Promise<void> {
  try {
    const rows = await detectCrossVenueAnomalies();
    if (rows.length) {
      console.warn("[cron] cross-venue anomalies — review manually:", rows);
    }
  } catch (e) {
    console.error("[cron] anomaly detection failed", e);
  }
}
