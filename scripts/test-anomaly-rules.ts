/**
 * Runnable unit checks for the pure data-anomaly rule catalog (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-anomaly-rules.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { auditVenue, hasAutoFixable, isHighConfidenceCorrection, type VenueAuditInput } from "@/lib/audit/anomalyRules";
import { computeCorrection, type StoredRow } from "@/lib/audit/computeCorrection";

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

check("implausible_active: an active >6h window from a non-HH page flags", () => {
  const codes = auditVenue({
    websiteUrl: "https://y.com", hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "10:00:00", endTime: "20:00:00", allDay: false, active: true, sourceUrl: "https://y.com/menu", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("implausible_active"));
});

check("implausible_active: a >6h window with NO sourceUrl flags", () => {
  const codes = auditVenue({
    websiteUrl: "https://y.com", hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "10:00:00", endTime: "20:00:00", allDay: false, active: true, sourceUrl: null, notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("implausible_active"), `expected implausible_active, got: ${JSON.stringify(codes)}`);
});

// Operator policy 2026-06-09: a page that is explicitly a happy-hour page (HH in the URL slug)
// vouches for its own wide window — "all day happy hour" is real, not a scraper error.
check("implausible_active: a >6h window sourced from an explicit HH page does NOT flag", () => {
  const codes = auditVenue({
    websiteUrl: "https://y.com", hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "10:00:00", endTime: "20:00:00", allDay: false, active: true, sourceUrl: "https://y.com/happy-hour", notes: null }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("implausible_active"), `unexpected implausible_active: ${JSON.stringify(codes)}`);
});

check("implausible_active: a degenerate window (start == end) flags even from an HH page", () => {
  const codes = auditVenue({
    websiteUrl: "https://y.com", hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "16:00:00", endTime: "16:00:00", allDay: false, active: true, sourceUrl: "https://y.com/happy-hour", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("implausible_active"), `expected implausible_active, got: ${JSON.stringify(codes)}`);
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

// --- Source-URL semantics (2026-06-09 triage: every stale/wrong row had a telling URL) ---

check("third_party_source: a scraper-mirror host differing from the venue's website flags", () => {
  const codes = auditVenue({
    websiteUrl: "https://theplayabarandgrill.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "16:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://the-playa-ii.weeblyte.com/specials", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("third_party_source"), `expected third_party_source, got: ${JSON.stringify(codes)}`);
});

check("third_party_source: a subdomain of the venue's own domain does NOT flag", () => {
  const codes = auditVenue({
    websiteUrl: "https://veroamorepizza.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "16:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://catering.veroamorepizza.com/happy-hour", notes: null }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("third_party_source"), `unexpected third_party_source: ${JSON.stringify(codes)}`);
});

check("third_party_source: first-party social (Instagram/Facebook) is exempt", () => {
  const codes = auditVenue({
    websiteUrl: "https://todosoakland.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "15:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://www.instagram.com/p/abc123/", notes: null }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("third_party_source"), `unexpected third_party_source: ${JSON.stringify(codes)}`);
});

check("third_party_source: no venue website on record → cannot judge, no flag", () => {
  const codes = auditVenue({
    websiteUrl: null,
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "16:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://somewhere.example.com/happy-hour", notes: null }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("third_party_source"), `unexpected third_party_source: ${JSON.stringify(codes)}`);
});

check("third_party_source: a site-builder CDN hosting the venue's own asset does NOT flag (wixstatic)", () => {
  const codes = auditVenue({
    websiteUrl: "http://www.themuletavern.com/",
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "15:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://static.wixstatic.com/media/00bbed_a5a6~mv2.jpg/v1/fill/MFOODWINTER.jpg", notes: null }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("third_party_source"), `unexpected third_party_source: ${JSON.stringify(codes)}`);
});

check("third_party_source: an image-proxy URL containing the venue's own domain does NOT flag (i0.wp.com)", () => {
  const codes = auditVenue({
    websiteUrl: "http://www.branchline.bar/",
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "15:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://i0.wp.com/branchline.bar/wp-content/uploads/2026/06/menu.jpg?w=1080", notes: null }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("third_party_source"), `unexpected third_party_source: ${JSON.stringify(codes)}`);
});

check("third_party_source: an HH-aggregator source flags (thehappyhourfinder)", () => {
  const codes = auditVenue({
    websiteUrl: "https://redgartertucson.com/",
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "15:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://thehappyhourfinder.com/us_az/tucson/red-garter-saloon/", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("third_party_source"), `expected third_party_source, got: ${JSON.stringify(codes)}`);
});

check("stale_event_source: a RECENT-year uploads path is a current menu, not stale (wp uploads 2025)", () => {
  const codes = auditVenue({
    websiteUrl: "https://brotzeitbiergarten.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://brotzeitbiergarten.com/wp-content/uploads/2025/11/Happy-Hour-Menu-2025-2.pdf", notes: null }],
  }, new Date("2026-06-09")).map((f) => f.code);
  assert.ok(!codes.includes("stale_event_source"), `unexpected stale_event_source: ${JSON.stringify(codes)}`);
});

check("stale_event_source: an OLD-year uploads path is a stale menu (2014 png)", () => {
  const codes = auditVenue({
    websiteUrl: "https://ovenandvine.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "11:00:00", endTime: "14:00:00", allDay: false, active: true, sourceUrl: "https://ovenandvine.com/wp-content/uploads/2014/08/happyhour.png", notes: null }],
  }, new Date("2026-06-09")).map((f) => f.code);
  assert.ok(codes.includes("stale_event_source"), `expected stale_event_source, got: ${JSON.stringify(codes)}`);
});

check("stale_event_source: an old upload dir with a CURRENT-year filename is not stale (Torero's)", () => {
  const codes = auditVenue({
    websiteUrl: "https://www.toreros-mexicanrestaurants.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "15:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://www.toreros-mexicanrestaurants.com/wp-content/uploads/2024/09/Toreros-Tacoma-HH-Food-April-2026.jpg", notes: null }],
  }, new Date("2026-06-09")).map((f) => f.code);
  assert.ok(!codes.includes("stale_event_source"), `unexpected stale_event_source: ${JSON.stringify(codes)}`);
});

check("stale_event_source: a year-dated event path flags (2023 barrel-release case)", () => {
  const codes = auditVenue({
    websiteUrl: "https://laescondidatucson.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [3, 5], startTime: "15:00:00", endTime: "16:30:00", allDay: false, active: true, sourceUrl: "https://laescondidatucson.com/2023/11/kxci-limited-release-barrell-event/", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("stale_event_source"), `expected stale_event_source, got: ${JSON.stringify(codes)}`);
});

check("stale_event_source: a holiday-special page flags (valentines case)", () => {
  const codes = auditVenue({
    websiteUrl: "https://mitamaoakland.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "12:00:00", endTime: "14:00:00", allDay: false, active: true, sourceUrl: "https://mitamaoakland.com/valentines-day-special.html", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("stale_event_source"), `expected stale_event_source, got: ${JSON.stringify(codes)}`);
});

check("stale_event_source: a seasonal-promo PDF flags (football flyer case)", () => {
  const codes = auditVenue({
    websiteUrl: "https://fatwillys.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [5], startTime: "11:00:00", endTime: "14:00:00", allDay: false, active: true, sourceUrl: "https://fatwillys.com/wp-content/uploads/fw_football_cr.pdf", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("stale_event_source"), `expected stale_event_source, got: ${JSON.stringify(codes)}`);
});

check("stale_event_source: a normal dedicated happy-hour page does NOT flag", () => {
  const flags = auditVenue({
    websiteUrl: "https://example.com",
    hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, active: true, sourceUrl: "https://example.com/happy-hour/", notes: null }],
  });
  assert.equal(flags.length, 0, `expected no flags, got: ${JSON.stringify(flags)}`);
});

// --- Offerings-aware parity with the reconcile gate (PRs #56–#59) ---
// The audit passes each window's offerings fingerprint into reconcileWindows so it agrees
// with the persist gate: per-day specials, day-subset extensions, and distinct-deal
// overlaps that the gate deliberately keeps must NOT re-flag here.

check("offerings: same-time windows with DIFFERENT deals are per-day specials, not duplicates", () => {
  const flags = auditVenue({
    websiteUrl: "https://specials.example.com", hoursJson: null,
    windows: [
      { daysOfWeek: [2], startTime: "16:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://specials.example.com/happy-hour", notes: null, offeringsKey: "taco|300" },
      { daysOfWeek: [3], startTime: "16:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://specials.example.com/happy-hour", notes: null, offeringsKey: "whiskey|600" },
    ],
  });
  assert.deepEqual(flags, [], `expected no flags, got: ${JSON.stringify(flags)}`);
});

check("offerings: a day-subset extension of the same deal (Tue 4–8 within Mon–Fri 4–6) does not flag overlap", () => {
  const flags = auditVenue({
    websiteUrl: "https://extension.example.com", hoursJson: null,
    windows: [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "18:00:00", allDay: false, active: true, sourceUrl: "https://extension.example.com/happy-hour", notes: null, offeringsKey: "well drinks|500" },
      { daysOfWeek: [2], startTime: "16:00:00", endTime: "20:00:00", allDay: false, active: true, sourceUrl: "https://extension.example.com/happy-hour", notes: null, offeringsKey: "well drinks|500" },
    ],
  });
  assert.deepEqual(flags, [], `expected no flags, got: ${JSON.stringify(flags)}`);
});

check("offerings: overlapping windows with DISTINCT deal sets coexist (no overlapping_windows)", () => {
  const flags = auditVenue({
    websiteUrl: "https://fondi.example.com", hoursJson: null,
    windows: [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: "11:00:00", endTime: "15:00:00", allDay: false, active: true, sourceUrl: "https://fondi.example.com/specials", notes: null, offeringsKey: "lunch menu|1200" },
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: "11:30:00", endTime: "14:00:00", allDay: false, active: true, sourceUrl: "https://fondi.example.com/specials", notes: null, offeringsKey: "pizza per due|1500" },
    ],
  });
  assert.deepEqual(flags, [], `expected no flags, got: ${JSON.stringify(flags)}`);
});

check("offerings: an operating-hours-shaped window carrying its OWN deal set stays unflagged (Twisted Fork)", () => {
  const flags = auditVenue({
    websiteUrl: "https://twistedfork.example.com",
    hoursJson: [{ openDay: 1, openMin: 11 * 60, closeDay: 1, closeMin: 21 * 60 }],
    windows: [{
      daysOfWeek: [1], startTime: "11:00:00", endTime: null, allDay: false,
      active: true, sourceUrl: "https://twistedfork.example.com/specials", notes: null, offeringsKey: "monday burger|900",
    }],
  });
  assert.deepEqual(flags, [], `expected no flags, got: ${JSON.stringify(flags)}`);
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

// isHighConfidenceCorrection — reject: sourced from a one-time-event page (La Escondida
// 2026-06-09: the re-extract only re-found a "final-friday" event window; its slug contains
// "happy-hours" so scoreHhUrl passed it, and the apply deactivated the venue's real Mon–Fri row).
check("isHighConfidenceCorrection returns false when a corrected window is event-page-sourced", () => {
  assert.ok(!isHighConfidenceCorrection([
    { daysOfWeek: [5], startTime: "17:30:00", endTime: "19:30:00", allDay: false, sourceUrl: "https://whiskeydelbac.com/event/final-friday-happy-hours-at-la-escondida-with-joe-pena/", notes: null },
  ]));
});

// isHighConfidenceCorrection — reject: empty array.
check("isHighConfidenceCorrection returns false for an empty corrections array", () => {
  assert.ok(!isHighConfidenceCorrection([]));
});

const storedLondon: StoredRow[] = [
  { id: "row-home", daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, active: true, sourceUrl: "https://londonbargrill.com/", notes: "days assumed Mon–Fri (none stated)" },
  { id: "row-menu", daysOfWeek: [1, 2, 3, 4, 5], startTime: "18:00:00", endTime: "21:00:00", allDay: false, active: true, sourceUrl: "https://londonbargrill.com/menu/", notes: "days assumed Mon–Fri (none stated)" },
];
// What the FIXED free parser returns from /happy-hour/: one real-days window, same clock as the home row.
// Uses PARSER-STYLE times ("HH:MM", no seconds) to lock normalization against DB-style stored times.
const correctedLondon = [
  { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00", endTime: "19:00", allDay: false, sourceUrl: "https://londonbargrill.com/happy-hour/", notes: null },
];

check("computeCorrection: updates the matching home row's provenance, deactivates /menu/", () => {
  const plan = computeCorrection(storedLondon, correctedLondon);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "row-home");
  assert.equal(plan.updates[0].sourceUrl, "https://londonbargrill.com/happy-hour/");
  assert.equal(plan.updates[0].notes, null);
  assert.deepEqual(plan.deactivations, ["row-menu"]);
  assert.equal(plan.inserts.length, 0);
});

check("computeCorrection: a corrected window with no stored match becomes an insert", () => {
  const plan = computeCorrection(
    [{ id: "r1", daysOfWeek: [6], startTime: "12:00:00", endTime: "15:00:00", allDay: false, active: true, sourceUrl: "https://x.com/", notes: null }],
    [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://x.com/happy-hour", notes: null }],
  );
  assert.equal(plan.inserts.length, 1);
  assert.deepEqual(plan.deactivations, ["r1"]);
});

check("computeCorrection: no provenance change → no-op update", () => {
  const plan = computeCorrection(
    [{ id: "r1", daysOfWeek: [1], startTime: "16:00:00", endTime: "19:00:00", allDay: false, active: true, sourceUrl: "https://x.com/happy-hour", notes: null }],
    [{ daysOfWeek: [1], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://x.com/happy-hour", notes: null }],
  );
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.deactivations.length, 0);
  assert.equal(plan.inserts.length, 0);
});

check("computeCorrection: a corrected window matching an INACTIVE stored row reactivates (update, no insert)", () => {
  const plan = computeCorrection(
    [{ id: "hidden", daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, active: false, sourceUrl: "https://x.com/", notes: "days assumed Mon–Fri (none stated)" }],
    [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00", endTime: "19:00", allDay: false, sourceUrl: "https://x.com/happy-hour", notes: null }],
  );
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.deactivations.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "hidden");
  assert.equal(plan.updates[0].sourceUrl, "https://x.com/happy-hour");
});

// ── 2026-06-10 flag-review rules (golden cases from the operator's corpus) ──

check("own_subdomain_source: catering subdomain flags (Vero Amore pattern)", () => {
  const codes = auditVenue({
    websiteUrl: "https://veroamorepizza.com/?utm_source=google",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "16:00:00", endTime: "18:00:00", allDay: false,
      active: true, sourceUrl: "https://catering.veroamorepizza.com/", notes: null,
    }],
  }).map((f) => f.code);
  assert.ok(codes.includes("own_subdomain_source"));
  assert.ok(!codes.includes("third_party_source"));
});

check("own_subdomain_source: www vs apex does NOT flag", () => {
  const codes = auditVenue({
    websiteUrl: "https://www.eatwoven.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "14:00:00", endTime: "17:00:00", allDay: false,
      active: true, sourceUrl: "https://eatwoven.com/menus/", notes: null,
    }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("own_subdomain_source"));
});

check("uniform_cheap_prices: $2-everything flags (Wooden Nickel pattern)", () => {
  const codes = auditVenue({
    websiteUrl: "https://www.woodennickeltavern.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "15:00:00", endTime: "18:00:00", allDay: false,
      active: true, sourceUrl: "https://www.woodennickeltavern.com/happy-hour", notes: null,
      offerings: [
        { kind: "drink", name: "Draft beers", description: null, priceCents: 200 },
        { kind: "drink", name: "Domestic bottles", description: null, priceCents: 200 },
        { kind: "drink", name: "Well drinks", description: null, priceCents: 200 },
      ],
    }],
  }).map((f) => f.code);
  assert.ok(codes.includes("uniform_cheap_prices"));
});

check("uniform_cheap_prices: three distinct prices do NOT flag", () => {
  const codes = auditVenue({
    websiteUrl: "https://x.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3], startTime: "15:00:00", endTime: "18:00:00", allDay: false,
      active: true, sourceUrl: "https://x.com/happy-hour", notes: null,
      offerings: [
        { kind: "drink", name: "Drafts", description: null, priceCents: 400 },
        { kind: "drink", name: "Wells", description: null, priceCents: 500 },
        { kind: "food", name: "Wings", description: null, priceCents: 800 },
      ],
    }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("uniform_cheap_prices"));
});

check("food_kinded_as_drink + day_mismatch_offering (Bistro 44 pattern)", () => {
  const codes = auditVenue({
    websiteUrl: "http://www.bistro44tucson.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "15:00:00", endTime: "17:00:00", allDay: false,
      active: true, sourceUrl: "http://www.bistro44tucson.com/happy-hour", notes: null,
      offerings: [{ kind: "drink", name: "Half Priced Burgers on Sunday", description: null, priceCents: null }],
    }],
  }).map((f) => f.code);
  assert.ok(codes.includes("food_kinded_as_drink"));
  assert.ok(codes.includes("day_mismatch_offering"));
});

check("monthly_event_window: 'every third Thursday' notes flag (Cook & Her Farmer pattern)", () => {
  const codes = auditVenue({
    websiteUrl: "http://www.thecookandherfarmer.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [4], startTime: "17:00:00", endTime: "19:00:00", allDay: false,
      active: true, sourceUrl: "http://www.thecookandherfarmer.com/x", notes: "Oyster hour every third Thursday in the garden",
    }],
  }).map((f) => f.code);
  assert.ok(codes.includes("monthly_event_window"));
});

check("stale_event_source: wedding/banquet path flags (WOLF Pool pattern)", () => {
  const codes = auditVenue({
    websiteUrl: "http://www.caesarsrepublicscottsdale.com/wolf-pool",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "15:00:00", endTime: "18:00:00", allDay: false,
      active: true, sourceUrl: "https://www.caesarsrepublicscottsdale.com/group-wedding-rooms", notes: null,
    }],
  }).map((f) => f.code);
  assert.ok(codes.includes("stale_event_source"));
});

check("clean venue with sane offerings raises none of the new codes", () => {
  const NEW_CODES = ["own_subdomain_source", "uniform_cheap_prices", "day_mismatch_offering", "food_kinded_as_drink", "monthly_event_window"] as const;
  const codes = auditVenue({
    websiteUrl: "https://goodbar.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00:00", endTime: "18:00:00", allDay: false,
      active: true, sourceUrl: "https://goodbar.com/happy-hour", notes: null,
      offerings: [
        { kind: "drink", name: "Drafts", description: null, priceCents: 500 },
        { kind: "food", name: "Wings", description: null, priceCents: 800 },
      ],
    }],
  }).map((f) => f.code);
  assert.ok(NEW_CODES.every((c) => !codes.includes(c)), `unexpected: ${codes.join(",")}`);
});

check("platform_website_url: ordering/link platforms flag (Ciao Grazie / Sushiholic pattern)", () => {
  for (const site of [
    "https://order.online/business/ciao-grazie-14123607?utm_source=google",
    "http://sushiholicarcadia.carrd.co/",
    "https://www.doordash.com/store/some-venue",
  ]) {
    const codes = auditVenue({
      websiteUrl: site,
      hoursJson: null,
      windows: [{
        daysOfWeek: [1, 2, 3], startTime: "15:00:00", endTime: "18:00:00", allDay: false,
        active: true, sourceUrl: "https://example.com/happy-hour", notes: null,
      }],
    }).map((f) => f.code);
    assert.ok(codes.includes("platform_website_url"), `should flag: ${site}`);
  }
  const own = auditVenue({
    websiteUrl: "https://www.eatwoven.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1], startTime: "15:00:00", endTime: "18:00:00", allDay: false,
      active: true, sourceUrl: "https://www.eatwoven.com/menus/", notes: null,
    }],
  }).map((f) => f.code);
  assert.ok(!own.includes("platform_website_url"));
});

check("shop_page_source: window sourced from a shop/product page flags (Frutiland, SLO 2026-06-12)", () => {
  const codes = auditVenue({
    websiteUrl: "https://frutiiland.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [5], startTime: "18:00:00", endTime: "23:00:00", allDay: false,
      active: true, sourceUrl: "https://frutiiland.com/collections/pastor-de-trompo", notes: "Friday Specials: tacos",
    }],
  }).map((f) => f.code);
  assert.ok(codes.includes("shop_page_source"));
});
check("shop_page_source: a normal menu page does NOT flag", () => {
  const codes = auditVenue({
    websiteUrl: "https://x.com/",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00:00", endTime: "18:00:00", allDay: false,
      active: true, sourceUrl: "https://x.com/happy-hour-menu/", notes: null,
    }],
  }).map((f) => f.code);
  assert.ok(!codes.includes("shop_page_source"));
});

console.log(`\n✓ ${passed} anomaly-rule checks passed.`);
