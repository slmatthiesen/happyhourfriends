/**
 * flagEval — score the CURRENT rule catalog (lib/audit/anomalyRules) against the
 * operator-labeled flag-review corpus (data/flag-review-goldens.json, written by the
 * retired export-flag-labels script). Pure, $0, no DB/network — unit-tested in
 * scripts/test-flag-eval.ts.
 *
 * Label semantics (from /admin/flags):
 *   kept   — operator judged the flagged data CORRECT → any flag the current rules
 *            still raise on the snapshot is a false alarm on adjudicated-good data.
 *   hidden — operator judged a window WRONG → the current rules should still raise
 *            ≥1 flag on the snapshot; silence means the catalog lost a true catch.
 */
import { auditVenue, type AnomalyFlag, type VenueAuditInput } from "@/lib/audit/anomalyRules";

export interface FlagLabelCase {
  city: string;
  venue: string;
  slug: string;
  label: "kept" | "hidden";
  /** Operator note from the review, when one was left. */
  note: string | null;
  /** What the rules raised at verdict time (data_audit.flags) — for drift comparison. */
  flagsAtVerdict: AnomalyFlag[];
  /** Natural keys (days|start|end) of the window(s) the operator hid; [] for kept. */
  hiddenWindows: string[];
  /** Rule inputs at scan time — auditVenue runs on exactly this. */
  input: VenueAuditInput;
}

export interface CaseResult {
  case_: FlagLabelCase;
  flagsNow: AnomalyFlag[];
  /** kept+silent or hidden+flagged. */
  agrees: boolean;
}

export interface CodeStats {
  /** Fires on operator-KEPT data (false alarms under current rules). */
  keptHits: number;
  /** Fires on operator-HIDDEN data (true catches retained). */
  hiddenHits: number;
}

export interface EvalReport {
  results: CaseResult[];
  perCode: Record<string, CodeStats>;
  keptTotal: number;
  /** Kept venues the current rules no longer flag (rules learned the lesson). */
  keptSilent: number;
  hiddenTotal: number;
  /** Hidden venues the current rules still flag (catches retained). */
  hiddenCaught: number;
}

export function evalCases(cases: FlagLabelCase[], now: Date = new Date()): EvalReport {
  const results: CaseResult[] = [];
  const perCode: Record<string, CodeStats> = {};
  let keptTotal = 0, keptSilent = 0, hiddenTotal = 0, hiddenCaught = 0;

  for (const c of cases) {
    const flagsNow = auditVenue(c.input, now);
    for (const f of flagsNow) {
      const s = (perCode[f.code] ??= { keptHits: 0, hiddenHits: 0 });
      if (c.label === "kept") s.keptHits++;
      else s.hiddenHits++;
    }
    let agrees: boolean;
    if (c.label === "kept") {
      keptTotal++;
      agrees = flagsNow.length === 0;
      if (agrees) keptSilent++;
    } else {
      hiddenTotal++;
      agrees = flagsNow.length > 0;
      if (agrees) hiddenCaught++;
    }
    results.push({ case_: c, flagsNow, agrees });
  }

  return { results, perCode, keptTotal, keptSilent, hiddenTotal, hiddenCaught };
}
