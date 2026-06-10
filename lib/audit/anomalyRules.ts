/**
 * anomalyRules — pure, deterministic catalog of "this stored happy-hour data looks fishy"
 * predicates. NO DB, NO network, NO AI ($0, unit-tested). Consumed by scripts/audit-data.ts.
 *
 * Only ACTIVE windows are audited (hidden rows are already withheld from users). Shape rules
 * (overlap / operating-hours / duplicate) reuse reconcileWindows so the audit and the persist
 * gate agree. Provenance rules (assumed-days, homepage-sourced) are audit-only.
 *
 * severity governs the fixer: `auto_fixable` flags may auto-apply a re-fetch correction;
 * `report` flags are surfaced for operator spot-check only.
 */
import { reconcileWindows, durationMin, type ReconcileWindow } from "@/lib/places/windowReconcile";
import { scoreHhUrl } from "@/lib/places/hhText";
import type { OpenPeriod } from "@/lib/geo/timezone";

export interface AuditWindow {
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  active: boolean;
  sourceUrl: string | null;
  notes: string | null;
  /** offeringsFingerprint of the window's offerings — lets the shared reconcile gate keep
   *  per-day specials, day-subset extensions, and distinct-deal overlaps (PRs #56–#59).
   *  Omitted/null → strict pre-discriminator behavior. */
  offeringsKey?: string | null;
}

export interface VenueAuditInput {
  /** Carried for the report and a possible future source-domain-vs-website rule; no rule reads it yet. */
  websiteUrl: string | null;
  hoursJson: OpenPeriod[] | null;
  windows: AuditWindow[];
}

export type AnomalySeverity = "auto_fixable" | "report";
export type AnomalyCode =
  | "assumed_days_avoidable"
  | "homepage_sourced_hh"
  | "overlapping_windows"
  | "duplicate_windows"
  | "operating_hours_active"
  | "implausible_active";

export interface AnomalyFlag {
  code: AnomalyCode;
  severity: AnomalySeverity;
  evidence: string;
}

const SEVERITY: Record<AnomalyCode, AnomalySeverity> = {
  assumed_days_avoidable: "auto_fixable",
  duplicate_windows: "auto_fixable",
  implausible_active: "auto_fixable",
  homepage_sourced_hh: "report",
  overlapping_windows: "report",
  operating_hours_active: "report",
};

function flag(code: AnomalyCode, evidence: string): AnomalyFlag {
  return { code, severity: SEVERITY[code], evidence };
}

/** notes carries the parser's assumed-days marker (parseHhText writes "days assumed Mon–Fri …"). */
function isAssumedDays(notes: string | null): boolean {
  return !!notes && notes.toLowerCase().includes("days assumed");
}

/** sourceUrl path is the bare domain or "/" (not an HH-specific page). */
function isHomepageSource(sourceUrl: string | null): boolean {
  if (!sourceUrl) return false;
  try {
    const p = new URL(sourceUrl).pathname.replace(/\/+$/, "");
    // trailing slashes already collapsed: "/" → ""
    return p === "";
  } catch {
    return false;
  }
}

/**
 * Retroactive plausibility check from STORED shape (mirrors parseHhText's plausible=false
 * cases we can see post-hoc): duration > 6h, or degenerate (both times known, duration ≤ 0).
 * Note: a long window (e.g. 10:00–20:00) can ALSO trip `operating_hours_active` via reconcile —
 * both are distinct codes and both are intentionally kept.
 */
function isImplausibleShape(w: AuditWindow): boolean {
  if (w.allDay) return false; // all-day handled by realness gate, not here
  const rw: ReconcileWindow = { daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay };
  const d = durationMin(rw);
  if (d === null) return false; // open-ended start/end — not a shape we can judge
  return d > 6 * 60 || d <= 0;
}

export function auditVenue(input: VenueAuditInput): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const active = input.windows.filter((w) => w.active);
  if (active.length === 0) return flags;

  // --- Provenance + shape, per-window ---
  for (const w of active) {
    if (isAssumedDays(w.notes)) {
      flags.push(flag("assumed_days_avoidable", `${w.sourceUrl ?? "?"} — ${w.notes}`));
    }
    if (isHomepageSource(w.sourceUrl)) {
      flags.push(flag("homepage_sourced_hh", `HH window sourced from homepage: ${w.sourceUrl}`));
    }
    if (isImplausibleShape(w)) {
      flags.push(flag("implausible_active", `active window ${w.startTime}–${w.endTime} is implausible (>6h or degenerate)`));
    }
  }

  // --- Shape across active windows, via the shared reconcile gate ---
  const recon = reconcileWindows(
    active.map((w) => ({ daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay, offeringsKey: w.offeringsKey })),
    input.hoursJson,
  );
  let overlapped = false;
  let operating = false;
  let duplicated = false;
  for (const r of recon) {
    if (r.reasons.includes("overlap_conflict")) overlapped = true;
    if (r.reasons.includes("operating_hours")) operating = true;
    if (r.reasons.includes("merged_duplicate")) duplicated = true;
  }
  if (overlapped) flags.push(flag("overlapping_windows", "two active windows overlap on shared days"));
  if (operating) flags.push(flag("operating_hours_active", "an active window looks like operating hours"));
  if (duplicated) flags.push(flag("duplicate_windows", "two active windows share start|end|allDay (days may differ)"));

  // De-dup identical (code) flags so a venue with 3 assumed windows reports the code once.
  const seen = new Set<string>();
  return flags.filter((f) => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
}

/** True when the venue has ≥1 auto_fixable flag (the fixer's candidacy gate). */
export function hasAutoFixable(flags: AnomalyFlag[]): boolean {
  return flags.some((f) => f.severity === "auto_fixable");
}

/** A re-parsed correction is HIGH-CONFIDENCE (safe to auto-apply) when every corrected
 *  window has REAL days, ≥1 is sourced from an HH-specific page, and reconcile keeps all. */
export function isHighConfidenceCorrection(
  corrected: Omit<AuditWindow, "active">[],
): boolean {
  if (corrected.length === 0) return false;
  if (corrected.some((w) => isAssumedDays(w.notes))) return false;
  if (!corrected.some((w) => (w.sourceUrl ? scoreHhUrl(w.sourceUrl) > 0 : false))) return false;
  const recon = reconcileWindows(
    corrected.map((w) => ({ daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay, offeringsKey: w.offeringsKey })),
  );
  return recon.every((r) => r.active);
}
