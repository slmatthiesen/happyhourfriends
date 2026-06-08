/**
 * Runnable unit checks for the pure data-anomaly rule catalog (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-anomaly-rules.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { auditVenue, hasAutoFixable, isHighConfidenceCorrection, type VenueAuditInput } from "@/lib/audit/anomalyRules";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// The grounding case: London Bar & Grill's STORED data (two active assumed-days windows,
// one homepage-sourced, the /menu/ one overlapping the /happy-hour/ one on Mon–Fri).
const london: VenueAuditInput = {
  websiteUrl: "https://londonbargrill.com",
  hoursJson: null,
  windows: [
    {
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false,
      active: true, sourceUrl: "https://londonbargrill.com/", notes: "days assumed Mon–Fri (none stated)",
    },
    {
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "18:00:00", endTime: "21:00:00", allDay: false,
      active: true, sourceUrl: "https://londonbargrill.com/menu/", notes: "days assumed Mon–Fri (none stated)",
    },
  ],
};

check("london: flags assumed_days_avoidable", () => {
  const codes = auditVenue(london).map((f) => f.code);
  assert.ok(codes.includes("assumed_days_avoidable"));
});
check("london: flags homepage_sourced_hh (the '/' window)", () => {
  const codes = auditVenue(london).map((f) => f.code);
  assert.ok(codes.includes("homepage_sourced_hh"));
});
check("london: flags overlapping_windows (16–19 vs 18–21 on Mon–Fri)", () => {
  const codes = auditVenue(london).map((f) => f.code);
  assert.ok(codes.includes("overlapping_windows"));
});

check("clean venue: a single real-days HH-page-sourced window yields NO flags", () => {
  const flags = auditVenue({
    websiteUrl: "https://example.com",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false,
      active: true, sourceUrl: "https://example.com/happy-hour/", notes: null,
    }],
  });
  assert.equal(flags.length, 0);
});

check("duplicate_windows: same days|start|end, differing source", () => {
  const codes = auditVenue({
    websiteUrl: "https://x.com", hoursJson: null,
    windows: [
      { daysOfWeek: [1], startTime: "15:00:00", endTime: "17:00:00", allDay: false, active: true, sourceUrl: "https://x.com/a", notes: null },
      { daysOfWeek: [1], startTime: "15:00:00", endTime: "17:00:00", allDay: false, active: true, sourceUrl: "https://x.com/b", notes: null },
    ],
  }).map((f) => f.code);
  assert.ok(codes.includes("duplicate_windows"));
});

check("implausible_active: an active >6h window flags", () => {
  const codes = auditVenue({
    websiteUrl: "https://y.com", hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "10:00:00", endTime: "20:00:00", allDay: false, active: true, sourceUrl: "https://y.com/happy-hour", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("implausible_active"));
});

check("inactive windows are ignored (only audit live data)", () => {
  const flags = auditVenue({
    websiteUrl: "https://z.com", hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "18:00:00", endTime: "21:00:00", allDay: false, active: false, sourceUrl: "https://z.com/", notes: "days assumed Mon–Fri (none stated)" }],
  });
  assert.equal(flags.length, 0);
});

// operating_hours_active: a window covering ≥80% of the venue's published opening hours
// on the majority of covered days triggers the operating_hours reconcile reason.
// Venue opens Mon 10:05–11:00 (55 min); window covers Mon 10:05–11:00 (55 min) = 100% ≥ 80%.
// Duration = 55 min < 6 h → implausible_active does NOT fire.
check("operating_hours_active fires when window covers most of the venue's opening hours", () => {
  const flags = auditVenue({
    websiteUrl: "https://operating.example.com",
    hoursJson: [
      { openDay: 1, openMin: 10 * 60 + 5, closeDay: 1, closeMin: 11 * 60 }, // Mon 10:05–11:00 (55 min)
    ],
    windows: [{
      daysOfWeek: [1], startTime: "10:05:00", endTime: "11:00:00", allDay: false,
      active: true, sourceUrl: "https://operating.example.com/hours", notes: null,
    }],
  });
  const codes = flags.map((f) => f.code);
  assert.ok(codes.includes("operating_hours_active"), `expected operating_hours_active, got: ${JSON.stringify(codes)}`);
});

// hasAutoFixable: true when the venue has an auto_fixable flag (duplicate_windows).
check("hasAutoFixable returns true when a duplicate_windows flag is present", () => {
  const flags = auditVenue({
    websiteUrl: "https://x.com", hoursJson: null,
    windows: [
      { daysOfWeek: [1], startTime: "15:00:00", endTime: "17:00:00", allDay: false, active: true, sourceUrl: "https://x.com/a", notes: null },
      { daysOfWeek: [1], startTime: "15:00:00", endTime: "17:00:00", allDay: false, active: true, sourceUrl: "https://x.com/b", notes: null },
    ],
  });
  assert.ok(hasAutoFixable(flags));
});

// hasAutoFixable: false when the only flag is report-severity (homepage_sourced_hh).
// Single window, real days, notes=null, plausible duration (≤6h), homepage URL.
check("hasAutoFixable returns false when the only flag is report-severity (homepage_sourced_hh)", () => {
  const flags = auditVenue({
    websiteUrl: "https://report-only.com", hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false,
      active: true, sourceUrl: "https://report-only.com/", notes: null,
    }],
  });
  // Verify this truly yields only report-severity flags.
  assert.ok(flags.length > 0, "expected at least one flag");
  assert.ok(flags.every((f) => f.severity === "report"), `expected all report, got: ${JSON.stringify(flags)}`);
  assert.ok(!hasAutoFixable(flags));
});

// isHighConfidenceCorrection — happy path: real days, HH-specific URL, clean reconcile.
check("isHighConfidenceCorrection returns true for a clean correction with an HH-specific URL", () => {
  assert.ok(isHighConfidenceCorrection([
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://x.com/happy-hour/", notes: null },
  ]));
});

// isHighConfidenceCorrection — reject: assumed days marker in notes.
check("isHighConfidenceCorrection returns false when notes contains assumed days", () => {
  assert.ok(!isHighConfidenceCorrection([
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://x.com/happy-hour/", notes: "days assumed Mon–Fri (none stated)" },
  ]));
});

// isHighConfidenceCorrection — reject: no HH-specific URL (homepage only).
check("isHighConfidenceCorrection returns false when sourceUrl is a homepage", () => {
  assert.ok(!isHighConfidenceCorrection([
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://x.com/", notes: null },
  ]));
});

// isHighConfidenceCorrection — reject: empty array.
check("isHighConfidenceCorrection returns false for an empty corrections array", () => {
  assert.ok(!isHighConfidenceCorrection([]));
});

console.log(`\n✓ ${passed} anomaly-rule checks passed.`);
