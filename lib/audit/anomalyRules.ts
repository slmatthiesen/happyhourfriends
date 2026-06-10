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
  /** Read by the third_party_source rule (source domain vs venue domain) and carried for the report. */
  websiteUrl: string | null;
  hoursJson: OpenPeriod[] | null;
  windows: AuditWindow[];
}

export type AnomalySeverity = "auto_fixable" | "report";
export type AnomalyCode =
  | "assumed_days_avoidable"
  | "homepage_sourced_hh"
  | "third_party_source"
  | "stale_event_source"
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
  third_party_source: "report",
  stale_event_source: "report",
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

/** First-party social posts are acceptable sources (operator policy); never "third-party". */
const SOCIAL_SOURCE_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.com)$/i;

/** Site-builder/CMS asset CDNs serve the VENUE'S OWN uploads (a menu PDF on wixstatic was
 *  discovered via a link on the venue's own page) — shared infrastructure, not a third party. */
const FIRST_PARTY_CDN_HOSTS =
  /(^|\.)(wixstatic\.com|wixsite\.com|squarespace-cdn\.com|wsimg\.com|shopify\.com|popmenucloud\.com|cdn-website\.com|website-files\.com|cloudfront\.net|azurefd\.net|wp\.com|godaddysites\.com)$/i;

/** Naive registrable domain (last two labels). Good enough for US venue domains; a
 *  ccTLD-aware eTLD+1 (publicsuffix) is overkill for a report-severity rule. */
function registrableDomain(host: string): string {
  return host.toLowerCase().split(".").filter(Boolean).slice(-2).join(".");
}

/**
 * sourceUrl lives on a different registrable domain than the venue's own website —
 * aggregators (thehappyhourfinder/tacotuesday), scraper mirrors (weeblyte/wheree),
 * directories (yelp/alignable), news articles. Every confirmed-wrong row in the
 * 2026-06-09 triage with a host mismatch was bucket-A. Not third-party: same-domain
 * subdomains, social posts, CMS asset CDNs, and image proxies whose path embeds the
 * venue's own domain (i0.wp.com/<venue-domain>/…). Unjudgeable without a stored website.
 */
function isThirdPartySource(sourceUrl: string | null, websiteUrl: string | null): boolean {
  if (!sourceUrl || !websiteUrl) return false;
  try {
    const src = new URL(sourceUrl);
    if (SOCIAL_SOURCE_HOSTS.test(src.hostname)) return false;
    if (FIRST_PARTY_CDN_HOSTS.test(src.hostname)) return false;
    const venueDomain = registrableDomain(new URL(websiteUrl).hostname);
    if (registrableDomain(src.hostname) === venueDomain) return false;
    if (src.pathname.toLowerCase().includes(venueDomain)) return false; // image proxy of the venue's own site
    return true;
  } catch {
    return false;
  }
}

/** One-time-event / seasonal-promo slugs. A recurring weekly window sourced from such a
 *  page is likely a one-off stored as recurring. */
const EVENT_PATH_RE =
  /(event|valentine|hallowe|christmas|nye|new-?year|mothers-?day|fathers-?day|st-?patrick|cinco[-_ ]de[-_ ]mayo|super-?bowl|football|game-?day|festival|limited[-_ ]release)/i;
/** Standalone year tokens in the path (uploads dirs, dated articles, menu filenames). */
const YEAR_TOKEN_RE = /(?<!\d)20\d{2}(?!\d)/g;
const STALE_AFTER_YEARS = 2;

/** Event-y slug, or every year token in the path is ≥2 years old (a 2014 menu PNG is
 *  stale; a /uploads/2025/11/ path holding a current menu — or an old dir holding a
 *  filename stamped with the current year — is not). */
function isStaleEventSource(sourceUrl: string | null, now: Date): boolean {
  if (!sourceUrl) return false;
  try {
    const path = decodeURIComponent(new URL(sourceUrl).pathname);
    if (EVENT_PATH_RE.test(path)) return true;
    const years = [...path.matchAll(YEAR_TOKEN_RE)].map((m) => Number(m[0]));
    if (years.length === 0) return false;
    return Math.max(...years) <= now.getFullYear() - STALE_AFTER_YEARS;
  } catch {
    return false;
  }
}

/**
 * Retroactive plausibility check from STORED shape (mirrors parseHhText's plausible=false
 * cases we can see post-hoc): duration > 6h, or degenerate (both times known, duration ≤ 0).
 * Operator policy (2026-06-09): an explicit happy-hour page (HH in the source URL) vouches
 * for its own wide window — "all day happy hour" is real, not a scraper error — so the >6h
 * branch is skipped for HH-URL sources. Degenerate stays flagged regardless of source.
 * Note: a long window (e.g. 10:00–20:00) can ALSO trip `operating_hours_active` via reconcile —
 * both are distinct codes and both are intentionally kept.
 */
function isImplausibleShape(w: AuditWindow): boolean {
  if (w.allDay) return false; // all-day handled by realness gate, not here
  // durationMin is cross-midnight aware, so start==end folds into 1440 min — catch the
  // degenerate shape on raw equality instead. No source can justify it.
  if (w.startTime && w.endTime && w.startTime.slice(0, 5) === w.endTime.slice(0, 5)) return true;
  const rw: ReconcileWindow = { daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay };
  const d = durationMin(rw);
  if (d === null) return false; // open-ended start/end — not a shape we can judge
  const hhPageSourced = w.sourceUrl ? scoreHhUrl(w.sourceUrl) >= 100 : false;
  return d > 6 * 60 && !hhPageSourced;
}

export function auditVenue(input: VenueAuditInput, now: Date = new Date()): AnomalyFlag[] {
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
    if (isThirdPartySource(w.sourceUrl, input.websiteUrl)) {
      flags.push(flag("third_party_source", `source domain differs from venue website (${input.websiteUrl}): ${w.sourceUrl}`));
    }
    if (isStaleEventSource(w.sourceUrl, now)) {
      flags.push(flag("stale_event_source", `recurring window sourced from a dated/event page: ${w.sourceUrl}`));
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
 *  window has REAL days, ≥1 is sourced from an HH-specific page, NONE is sourced from a
 *  dated/event page (an event slug containing "happy-hours" passes scoreHhUrl — the
 *  La Escondida final-friday regression), and reconcile keeps all. */
export function isHighConfidenceCorrection(
  corrected: Omit<AuditWindow, "active">[],
  now: Date = new Date(),
): boolean {
  if (corrected.length === 0) return false;
  if (corrected.some((w) => isAssumedDays(w.notes))) return false;
  if (corrected.some((w) => isStaleEventSource(w.sourceUrl, now))) return false;
  if (!corrected.some((w) => (w.sourceUrl ? scoreHhUrl(w.sourceUrl) > 0 : false))) return false;
  const recon = reconcileWindows(
    corrected.map((w) => ({ daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay, offeringsKey: w.offeringsKey })),
  );
  return recon.every((r) => r.active);
}
