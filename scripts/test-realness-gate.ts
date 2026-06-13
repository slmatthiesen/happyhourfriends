/**
 * Runnable unit checks for the pure realness gate (no test framework in repo).
 * Run: npx tsx scripts/test-realness-gate.ts — exits non-zero on any failure.
 *
 * The gate NEVER drops data; it only decides whether a stored window is shown
 * (active) or hidden for review (suspect). See
 * docs/superpowers/specs/2026-05-31-capture-everything-realness-filter-design.md.
 */
import assert from "node:assert/strict";
import {
  assessRealness,
  windowShouldBeActive,
  mealSpecialEvidence,
  MIN_CONFIDENCE,
} from "@/lib/places/realnessGate";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A normal, confident, bounded window (the Aunt Chiladas shape: Mon–Fri, open–6pm).
const GOOD = { allDay: false, dayCount: 5, timeKnown: true, confidence: 0.9 };

check("a bounded, confident window is NOT suspect (Aunt Chiladas)", () => {
  const r = assessRealness(GOOD);
  assert.equal(r.suspect, false);
  assert.deepEqual(r.reasons, []);
});

check("an open-until-X window (timeKnown via end) is NOT suspect", () => {
  // start null, end known → timeKnown true, allDay false
  const r = assessRealness({ allDay: false, dayCount: 5, timeKnown: true, confidence: 0.8 });
  assert.equal(r.suspect, false);
});

check("explicit all-day on 1 day is NOT suspect", () => {
  const r = assessRealness({ allDay: true, dayCount: 1, timeKnown: true, confidence: 0.9 });
  assert.equal(r.suspect, false);
});

check("explicit all-day on 2 days is NOT suspect", () => {
  const r = assessRealness({ allDay: true, dayCount: 2, timeKnown: true, confidence: 0.9 });
  assert.equal(r.suspect, false);
});

check("all-day on 3 days IS suspect (likely regular pricing)", () => {
  const r = assessRealness({ allDay: true, dayCount: 3, timeKnown: true, confidence: 0.9 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("all_day_many_days"));
});

check("all-day every day (7) IS suspect", () => {
  const r = assessRealness({ allDay: true, dayCount: 7, timeKnown: true, confidence: 0.95 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("all_day_many_days"));
});

check("no time info at all IS suspect (no_time_window)", () => {
  // coerced all-day with timeKnown false
  const r = assessRealness({ allDay: true, dayCount: 2, timeKnown: false, confidence: 0.9 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("no_time_window"));
});

check("low confidence IS suspect even for a clean window", () => {
  const r = assessRealness({ ...GOOD, confidence: MIN_CONFIDENCE - 0.01 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("low_confidence"));
});

check("confidence exactly at the threshold is NOT low_confidence", () => {
  const r = assessRealness({ ...GOOD, confidence: MIN_CONFIDENCE });
  assert.equal(r.reasons.includes("low_confidence"), false);
});

check("multiple signals accumulate distinct reasons", () => {
  const r = assessRealness({ allDay: true, dayCount: 7, timeKnown: false, confidence: 0.1 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("all_day_many_days"));
  assert.ok(r.reasons.includes("no_time_window"));
  assert.ok(r.reasons.includes("low_confidence"));
});

// windowShouldBeActive — the shared "show this window?" decision. A window goes live
// ONLY if the realness gate is happy AND the free parser did not flag it implausible.
// This is the bug enrich had: it honored realness but ignored the free-parser suspect flag,
// so an implausible free window (london's dinner-menu 6–9pm twin) went live.
check("active when neither the realness gate nor the free parser is suspicious", () => {
  assert.equal(windowShouldBeActive({ realnessSuspect: false, freeSuspect: false }), true);
});
check("HIDDEN when the free parser flagged the window implausible (realness fine)", () => {
  assert.equal(windowShouldBeActive({ realnessSuspect: false, freeSuspect: true }), false);
});
check("HIDDEN when the realness gate is suspicious (free parser fine)", () => {
  assert.equal(windowShouldBeActive({ realnessSuspect: true, freeSuspect: false }), false);
});
check("freeSuspect defaults to false (paid-extractor windows have no free flag)", () => {
  assert.equal(windowShouldBeActive({ realnessSuspect: false }), true);
});

// ── meal_special — meal services / events stored as happy hours ─────────────────
// Goldens from the 2026-06-12 all-city price scan: every positive below was a LIVE
// window that is plainly meal service or an event, every negative is a real (if
// upscale) happy hour from the same scan that must stay live.

const off = (name: string, dollars: number | null, description: string | null = null) => ({
  name,
  priceCents: dollars == null ? null : Math.round(dollars * 100),
  description,
});

check("MEAL: 'Dinner Special' 5–10pm IS meal service (La Herradura)", () => {
  const ev = mealSpecialEvidence({
    startTime: "17:00",
    endTime: "22:00",
    offerings: [off("Dinner Special", 14.99)],
  });
  assert.ok(ev, "expected evidence");
  const r = assessRealness({
    allDay: false,
    dayCount: 3,
    timeKnown: true,
    confidence: 0.9,
    mealSpecial: { startTime: "17:00", endTime: "22:00", offerings: [off("Dinner Special", 14.99)] },
  });
  assert.ok(r.reasons.includes("meal_special"));
});

check("MEAL: 'Prix Fixe' lexicon fires regardless of price (The Italian Daughter)", () => {
  assert.ok(
    mealSpecialEvidence({
      startTime: "14:00",
      endTime: "17:30",
      offerings: [off("Late Lunch or Early Dinner Prix Fixe", 33)],
    }),
  );
});

check("MEAL: 'Lunch special' name + lunch window (The Vig 11–3)", () => {
  assert.ok(
    mealSpecialEvidence({
      startTime: "11:00",
      endTime: "15:00",
      offerings: [off("Lunch special: soft drink + choice of entree", 16)],
    }),
  );
});

check("MEAL: tokenless lunch window with avg > $12 (Izumi 11–3)", () => {
  assert.ok(
    mealSpecialEvidence({
      startTime: "11:00",
      endTime: "15:00",
      offerings: [off("Combo Chow Mein", 18), off("Fried Rice", 20), off("Shrimp Specials", 13.99)],
    }),
  );
});

check("MEAL: single expensive item, no token, classic HH window (Spencer's $42 3–5pm)", () => {
  assert.ok(
    mealSpecialEvidence({ startTime: "15:00", endTime: "17:00", offerings: [off("", 42)] }),
  );
});

check("MEAL: events are caught by lexicon (50 Shades 'Paint and Sip', 'Girl Dinner')", () => {
  assert.ok(mealSpecialEvidence({ startTime: null, endTime: null, offerings: [off("Paint and Sip", 25)] }));
  assert.ok(mealSpecialEvidence({ startTime: null, endTime: null, offerings: [off("Girl Dinner", 20)] }));
});

check("MEAL: 'Early-Bird Dinner specials' fires (CJ's Cafe)", () => {
  assert.ok(
    mealSpecialEvidence({
      startTime: "14:00",
      endTime: "17:00",
      offerings: [off("Early-Bird Dinner specials", 15.95)],
    }),
  );
});

check("MEAL: 'Bottomless Bubbles' brunch fires on token even with a null start (PV Pie)", () => {
  assert.ok(
    mealSpecialEvidence({ startTime: null, endTime: "15:00", offerings: [off("Bottomless Bubbles", 19)] }),
  );
});

check("NOT MEAL: Postino $25 board + bottle after 8pm stays live", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "20:00",
      endTime: null,
      offerings: [off("Board of bruschetta & bottle of wine", 25)],
    }),
    null,
  );
});

check("NOT MEAL: upscale HH with cheap anchor items stays live (Maple & Ash)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "16:00",
      endTime: "18:00",
      offerings: [off("Mini seafood towers", 40), off("Select cocktails", 15), off("Oysters", 3)],
    }),
    null,
  );
});

check("NOT MEAL: 5–6pm window does NOT look like dinner service (Nobu 17–18)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "17:00",
      endTime: "18:00",
      offerings: [off("Cold Dishes", 20), off("Hot Dishes", 16), off("Half Orders", 16)],
    }),
    null,
  );
});

check("NOT MEAL: explicit happy-hour text VETOES every signal (Quesadilla Gorilla)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "11:00",
      endTime: "15:00",
      offerings: [off("$15 Happy Hour Monday", 15), off("Oaxaca Old Fashioned", 15)],
    }),
    null,
  );
});

check("NOT MEAL: happy-hour source URL vetoes a lunch-token offering", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "15:00",
      endTime: "18:00",
      sourceUrl: "https://example.com/happy-hour",
      offerings: [off("Lunch portion fish & chips", 14)],
    }),
    null,
  );
});

check("NOT MEAL: many priced items with a cheap floor is a real menu (Sullivan's)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "15:00",
      endTime: "18:00",
      offerings: [
        off("Jumbo Shrimp Cocktail", 20),
        off("Crab Cake Sliders", 20),
        off("Cheeseburger", 16),
        off("Well drinks", 8),
        off("Draft beer", 6),
      ],
    }),
    null,
  );
});

check("NOT MEAL: late-night crosses-midnight window never matches dinner shape", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "22:00",
      endTime: "01:00",
      offerings: [off("Night-owl cocktails", 13), off("Wings", 14)],
    }),
    null,
  );
});

check("MEAL: no offerings at all → no evidence (nothing to judge)", () => {
  assert.equal(mealSpecialEvidence({ startTime: "11:00", endTime: "15:00", offerings: [] }), null);
});

check("assessRealness without mealSpecial input behaves exactly as before", () => {
  const r = assessRealness(GOOD);
  assert.equal(r.suspect, false);
});

// ── bare-window gate (diagnosis bucket #2) ──────────────────────────────────────
// A time window with ZERO offerings AND no happy-hour wording on its source is
// operating hours or a lunch/menu page captured as a deal — hide for review.
// Goldens from the 2026-06-13 diagnosis (Quarterdeck, Sliver Pizzeria).
const bare = (over: Partial<Parameters<typeof assessRealness>[0]["mealSpecial"]> = {}) => ({
  allDay: false,
  dayCount: 5,
  timeKnown: true,
  confidence: 0.9,
  mealSpecial: { startTime: "15:00", endTime: "17:00", notes: null, sourceUrl: null, offerings: [], ...over },
});

check("GOLDEN Quarterdeck: M–F 3–5pm, no offerings, menu-page source IS suspect", () => {
  const r = assessRealness(bare({ sourceUrl: "https://thequarterdeck.com/menu" }));
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("no_offerings_no_hh_text"));
});

check("GOLDEN Sliver: M–F window from a /lunch-deals page, no offerings IS suspect", () => {
  const r = assessRealness(bare({ startTime: "14:00", endTime: "16:30", sourceUrl: "https://sliverpizzeria.com/lunch-deals" }));
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("no_offerings_no_hh_text"));
});

check("bare window VETOED by 'happy hour' in notes stays live (North Italia)", () => {
  const r = assessRealness(bare({ notes: "Happy Hour Mon–Fri 3–6pm in the bar" }));
  assert.equal(r.reasons.includes("no_offerings_no_hh_text"), false);
});

check("bare window VETOED by a /happy-hour source URL stays live", () => {
  const r = assessRealness(bare({ sourceUrl: "https://example.com/happy-hour" }));
  assert.equal(r.reasons.includes("no_offerings_no_hh_text"), false);
});

check("'social hour' wording also vetoes the bare-window gate", () => {
  const r = assessRealness(bare({ notes: "Social Hour 3–5pm" }));
  assert.equal(r.reasons.includes("no_offerings_no_hh_text"), false);
});

check("a window WITH offerings is never a bare phantom (even with no HH wording)", () => {
  const r = assessRealness({
    allDay: false, dayCount: 5, timeKnown: true, confidence: 0.9,
    mealSpecial: { startTime: "16:00", endTime: "18:00", notes: null, sourceUrl: "https://x.com/menu", offerings: [off("Draft beer", 5)] },
  });
  assert.equal(r.reasons.includes("no_offerings_no_hh_text"), false);
  assert.equal(r.suspect, false);
});

// ── crosses-midnight implausible duration (diagnosis bucket #3) ─────────────────
// The Backyard's "11pm–2pm" was stored as a 23:00→14:00 window — a 15h "happy hour"
// that crosses midnight, i.e. a parse error. A real late-night HH that crosses midnight
// is short (11pm–2am). Hide when the wrap-around duration is implausibly long (>6h).
const dur = (startTime: string, endTime: string) =>
  assessRealness({
    allDay: false, dayCount: 5, timeKnown: true, confidence: 0.9,
    mealSpecial: { startTime, endTime, notes: "Happy Hour", offerings: [off("Draft beer", 5)] },
  });

check("GOLDEN Backyard: 23:00→14:00 (15h crosses-midnight) IS suspect", () => {
  const r = dur("23:00", "14:00");
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("implausible_window_duration"));
});
check("a real late-night HH 23:00→02:00 (3h) is NOT a duration problem", () => {
  const r = dur("23:00", "02:00");
  assert.equal(r.reasons.includes("implausible_window_duration"), false);
});
check("a normal non-crossing window 16:00→18:00 is NOT a duration problem", () => {
  const r = dur("16:00", "18:00");
  assert.equal(r.reasons.includes("implausible_window_duration"), false);
});
check("an exactly-6h crossing window (22:00→04:00) is allowed (boundary)", () => {
  const r = dur("22:00", "04:00");
  assert.equal(r.reasons.includes("implausible_window_duration"), false);
});

console.log(`\n${passed} checks passed.`);
