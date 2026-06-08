/**
 * Runnable unit checks for the pure data-anomaly rule catalog (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-anomaly-rules.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { auditVenue, type VenueAuditInput } from "@/lib/audit/anomalyRules";

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

console.log(`\n✓ ${passed} anomaly-rule checks passed.`);
