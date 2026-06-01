
/** Minimum extractor/verifier confidence to auto-apply a first-party contribution. */
export const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.85;

export interface ContributionRouteInput {
  /** Submitted URL is on the venue's own website (see isFirstPartyUrl). */
  firstParty: boolean;
  /** Extractor/verifier confidence 0..1. */
  confidence: number;
  submitterBanned: boolean;
  /** submitter_trust.trust_score; must be >= 0 (good standing) to auto-apply. */
  submitterTrustScore: number;
  /** venue closed / no_happy_hour — never auto-applies. */
  critical: boolean;
  /** CONTRIBUTION_AUTOAPPLY flag (see isAutoApplyEnabled). */
  autoApplyEnabled: boolean;
}

/**
 * The single auto-apply-vs-queue decision. Auto-apply ONLY when ALL hold:
 * flag on, first-party source, high confidence, non-critical change, and a
 * good-standing submitter. Everything else is queued for the operator.
 */
export function routeContribution(i: ContributionRouteInput): "auto_apply" | "queue" {
  const ok =
    i.autoApplyEnabled &&
    i.firstParty &&
    !i.critical &&
    !i.submitterBanned &&
    i.submitterTrustScore >= 0 &&
    i.confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD;
  return ok ? "auto_apply" : "queue";
}

/** Reads the launch flag. Default OFF — everything queues until explicitly enabled. */
export function isAutoApplyEnabled(): boolean {
  const v = (process.env.CONTRIBUTION_AUTOAPPLY ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
