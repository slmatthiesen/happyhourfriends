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
  qualifiesForAllDayConsistencyRescue,
  MIN_CONFIDENCE,
  type RealnessReason,
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

check("all-day BARE artifact (1 day, no offerings, no HH wording) IS suspect (Lion's Tale image misread)", () => {
  const r = assessRealness({
    allDay: true, dayCount: 1, timeKnown: true, confidence: 0.9,
    mealSpecial: { startTime: null, endTime: null, notes: null, offerings: [] },
  });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("bare_non_hh_window"));
});

check("all-day on 1 day WITH offerings is NOT suspect (real all-day Tuesday deal)", () => {
  const r = assessRealness({
    allDay: true, dayCount: 1, timeKnown: true, confidence: 0.9,
    mealSpecial: { startTime: null, endTime: null, notes: null, offerings: [{ name: "$5 mimosas", priceCents: 500 }] },
  });
  assert.equal(r.suspect, false);
});

check("all-day BARE but notes say 'happy hour' is NOT suspect (HH veto)", () => {
  const r = assessRealness({
    allDay: true, dayCount: 1, timeKnown: true, confidence: 0.9,
    mealSpecial: { startTime: null, endTime: null, notes: "All-day happy hour Mondays", offerings: [] },
  });
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

check("low confidence but KNOWN time + offerings is NOT suspect (Blanco: conf 0.4, M–F 3–6pm, real deals)", () => {
  const r = assessRealness({
    allDay: false, dayCount: 5, timeKnown: true, confidence: 0.4,
    mealSpecial: { startTime: "15:00", endTime: "18:00", notes: null, offerings: [{ name: "House margarita", priceCents: 700 }] },
  });
  assert.equal(r.reasons.includes("low_confidence"), false);
  assert.equal(r.suspect, false);
});

check("low confidence + KNOWN time but NO offerings still IS low_confidence (no concrete evidence)", () => {
  const r = assessRealness({ allDay: false, dayCount: 5, timeKnown: true, confidence: 0.4, mealSpecial: { startTime: "15:00", endTime: "18:00", notes: null, offerings: [] } });
  assert.ok(r.reasons.includes("low_confidence"));
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

// ── food-menu-at-service-hours — a window that IS the venue's dinner service ─────
// Arrivederci's "happy hour" (4–9pm, every day) is an all-food, $14–22 entrée list ending
// at the 8:30pm close, scraped off /menu/happy-hour. The biggest tell is the hours: they're
// the dinner-service hours, so the window runs to close. Must fire even through the
// /happy-hour url slug (which clears the ambiguous price/timing signals).
const foodOff = (name: string, dollars: number | null, description: string | null = null) => ({
  ...off(name, dollars, description),
  kind: "food",
});
const drinkOff = (name: string, dollars: number | null) => ({ ...off(name, dollars, null), kind: "drink" });
const closesAt = (closeMin: number) =>
  [1, 2, 3, 4, 5, 6, 7].map((d) => ({ openDay: d, openMin: 11 * 60, closeDay: d, closeMin }));

check("MEAL: all-food entrée list running to close fires THROUGH a /happy-hour url (Arrivederci)", () => {
  const ev = mealSpecialEvidence({
    startTime: "16:00",
    endTime: "21:00", // ends past the 20:30 close
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    hoursJson: closesAt(20 * 60 + 30),
    sourceUrl: "https://www.arrivederci.restaurant/menu/happy-hour",
    offerings: [foodOff("Salmon Piccata", 14), foodOff("Cioppino", 20), foodOff("Pollo Pizzaiola", 22)],
  });
  assert.ok(ev, "expected dinner-service evidence through the url veto");
  assert.match(ev, /closing time/);
});

check("NOT MEAL: real brewery HH with drinks running to close stays live (CCB shape)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "16:00",
      endTime: "21:00",
      daysOfWeek: [4, 5, 6],
      hoursJson: closesAt(21 * 60),
      sourceUrl: "https://example.com/happy-hour",
      offerings: [drinkOff("Draft Pint", 4), foodOff("Pretzel", 6)],
    }),
    null,
  );
});

check("NOT MEAL: all-food but cheap (avg < $12) running to close stays live", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "16:00",
      endTime: "21:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      hoursJson: closesAt(21 * 60),
      offerings: [foodOff("Sliders", 8), foodOff("Wings", 9)],
    }),
    null,
  );
});

check("NOT MEAL: all-food high-price but ends well before close stays live (4–6pm HH)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "16:00",
      endTime: "18:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      hoursJson: closesAt(22 * 60),
      sourceUrl: "https://example.com/happy-hour",
      offerings: [foodOff("Flatbread", 14), foodOff("Calamari", 15)],
    }),
    null,
  );
});

check("NOT MEAL: explicit 'happy hour' wording clears the food-menu signal (ownVeto)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "16:00",
      endTime: "21:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      hoursJson: closesAt(20 * 60 + 30),
      offerings: [foodOff("Happy Hour Entrée Sampler", 15)],
    }),
    null,
  );
});

check("NOT MEAL: open-ended 'until close' deal stays live (Postino 8pm board & bottle)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "20:00",
      endTime: null, // until close — a real HH shape, not a dinner-service tell
      daysOfWeek: [1, 2],
      hoursJson: closesAt(22 * 60),
      offerings: [foodOff("Board of bruschetta & bottle of wine", 25, "Board + Bottle deal")],
    }),
    null,
  );
});

check("NOT MEAL: single weekly food special stays live (Wicked 6 $12 burger Thu)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "17:00",
      endTime: "20:00",
      daysOfWeek: [4],
      hoursJson: closesAt(20 * 60),
      offerings: [foodOff("Burger and French fries", 12)],
    }),
    null,
  );
});

check("NOT MEAL: combo naming alcohol is a real HH deal, not a food menu (burger + draft beer)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "16:00",
      endTime: "21:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      hoursJson: closesAt(20 * 60 + 30),
      offerings: [foodOff("Genuine cheeseburger + draft beer", 15), foodOff("Sliders + house wine", 16), foodOff("Tacos + margarita", 14)],
    }),
    null,
  );
});

check("NOT MEAL: food-menu signal needs hours data — no hoursJson, bounded end → stays live", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "16:00",
      endTime: "21:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      hoursJson: null,
      sourceUrl: "https://example.com/happy-hour",
      offerings: [foodOff("Salmon", 18), foodOff("Steak", 24), foodOff("Pasta", 19)],
    }),
    null,
  );
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

check("MEAL: a 'lunch' token fires even when the page URL slug says happy-hour (URL not per-window proof)", () => {
  // REVERSED 2026-06-14: a shared /happy-hour page slug no longer vetoes — it was whitelisting
  // breakfast/operating-hours rows scraped off a venue's happy-hour landing page (La Herradura).
  assert.ok(
    mealSpecialEvidence({
      startTime: "15:00",
      endTime: "18:00",
      sourceUrl: "https://example.com/happy-hour",
      offerings: [off("Lunch portion fish & chips", 14)],
    }),
  );
});

check("VETO still works on the window's OWN text: 'happy hour' in the offering name keeps it live", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "15:00",
      endTime: "18:00",
      offerings: [off("Happy Hour fish & chips", 14)],
    }),
    null,
  );
});

check("GOLDEN La Herradura: 7am–noon 'Breakfast Special' off a /happy-hours page IS meal service", () => {
  const ev = mealSpecialEvidence({
    startTime: "07:00",
    endTime: "12:00",
    sourceUrl: "https://laherradurakitchen.com/...-happy-hours-specials",
    offerings: [off("Breakfast Special", null)],
  });
  assert.ok(ev, "breakfast token must fire despite the happy-hours page URL");
  assert.match(ev, /breakfast/i);
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

// ── time-only lunch-band rule (operator 2026-06-14): 11–2 = lunch, not happy hour ──
check("LUNCH: cheap 11–2 window with food items IS meal service (no $12 needed)", () => {
  const ev = mealSpecialEvidence({
    startTime: "11:00",
    endTime: "14:00",
    offerings: [off("Pho", 11), off("Spring rolls", 6), off("Banh mi", 9)],
  });
  assert.ok(ev, "cheap lunch-band menu should now fire");
  assert.match(ev, /lunch-hours window/);
});

check("LUNCH: 12–3 window also fires (within band)", () => {
  assert.ok(mealSpecialEvidence({ startTime: "12:00", endTime: "15:00", offerings: [off("Bento box", 14)] }));
});

check("MEAL TOKEN beats page-URL: 'Lunch Special' at 10–2 off a /happy-hours page fires (La Herradura)", () => {
  const ev = mealSpecialEvidence({
    startTime: "10:00",
    endTime: "14:00",
    sourceUrl: "https://laherradurakitchen.com/...-happy-hours-specials",
    offerings: [off("Lunch Special", 11.99)],
  });
  assert.ok(ev, "explicit meal token fires regardless of the happy-hours page URL");
  assert.match(ev, /meal-service language/);
});

check("GOLDEN Vix Creek: 2–4pm food list (avg $11) off a HappyHour-Menu.pdf STAYS LIVE (URL veto on timing)", () => {
  // The exact regression caught 2026-06-15: real HH demoted because the URL veto was dropped.
  const ev = mealSpecialEvidence({
    startTime: "14:00",
    endTime: "16:00",
    sourceUrl: "https://static1.squarespace.com/.../VCS-HappyHour-Menu.pdf",
    offerings: [off("Chicken Wings", 6), off("Sliders", 12), off("Steak Bites", 14), off("Fish Tacos", 10)],
  });
  assert.equal(ev, null);
});

check("GOLDEN Trattoria Pina: '<meal> menu' is a menu citation, NOT meal service (drinks + 'Dinner menu appetizers')", () => {
  // Real HH demoted because "Dinner menu appetizers" tripped the meal token. "Dinner menu" cites a menu.
  assert.equal(
    mealSpecialEvidence({
      startTime: "17:00",
      endTime: "18:30",
      offerings: [off("All cocktails", null), off("Glass of wine", null), off("Dinner menu appetizers", null)],
    }),
    null,
  );
});

check("but 'Dinner Special' (no 'menu') still fires", () => {
  assert.ok(mealSpecialEvidence({ startTime: "17:00", endTime: "22:00", offerings: [off("Dinner Special", 15)] }));
});

check("but the SAME 2–4pm food window with NO happy-hour source IS a lunch window", () => {
  const ev = mealSpecialEvidence({
    startTime: "14:00",
    endTime: "16:00",
    offerings: [off("Chicken Wings", 6), off("Sliders", 12)],
  });
  assert.ok(ev);
  assert.match(ev, /lunch-hours window/);
});

check("LUNCH: explicit 'happy hour' text VETOES the lunch-band rule (midday HH survives)", () => {
  assert.equal(
    mealSpecialEvidence({
      startTime: "12:00",
      endTime: "15:00",
      notes: "Happy Hour Mon–Fri 12–3pm",
      offerings: [off("Draft beer", 4)],
    }),
    null,
  );
});

check("LUNCH: a 3–6pm HH window is NOT caught by the lunch-band rule (start past 14:00)", () => {
  assert.equal(
    mealSpecialEvidence({ startTime: "15:00", endTime: "18:00", offerings: [off("Well drinks", 5), off("Sliders", 7)] }),
    null,
  );
});

check("LUNCH: an 11–6pm all-afternoon window does NOT fire (end past 16:00, not lunch-contained)", () => {
  assert.equal(
    mealSpecialEvidence({ startTime: "11:00", endTime: "18:00", offerings: [off("Pizza slice", 4)] }),
    null,
  );
});

check("assessRealness without mealSpecial input behaves exactly as before", () => {
  const r = assessRealness(GOOD);
  assert.equal(r.suspect, false);
});

// ── bare-window gate — TIME-FIRST policy (operator directive 2026-06-14) ─────────
// REVERSES the 2026-06-13 bucket-#2 rule. Operator: a window with a CONFIRMED bounded
// time goes LIVE even with no published food/drink ("if time, show it live"). A bare
// window is now suspect ONLY when its clock span covers most of an operating day (≥6h)
// AND it carries no happy-hour wording — i.e. it is operating hours, not a deal. The
// reconcile gate (isOperatingHours) is the authoritative op-hours check when hours_json
// exists; this duration backstop covers venues with no hours data. Reason id renamed
// no_offerings_no_hh_text → bare_operating_hours.
const bare = (over: Partial<Parameters<typeof assessRealness>[0]["mealSpecial"]> = {}) => ({
  allDay: false,
  dayCount: 5,
  timeKnown: true,
  confidence: 0.9,
  mealSpecial: { startTime: "15:00", endTime: "17:00", notes: null, sourceUrl: null, offerings: [], ...over },
});

check("NEW POLICY: M–F 3–5pm bare window, menu-page source, goes LIVE (confirmed time)", () => {
  const r = assessRealness(bare({ sourceUrl: "https://thequarterdeck.com/menu" }));
  assert.equal(r.suspect, false);
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("NEW POLICY: bare 2–4:30pm afternoon window goes LIVE (start past noon)", () => {
  const r = assessRealness(bare({ startTime: "14:00", endTime: "16:30", sourceUrl: "https://sliverpizzeria.com/menu" }));
  assert.equal(r.suspect, false);
});

check("GOLDEN Super Duper shape: bare M–F 4–6pm goes LIVE (the 2-weeks-hidden case)", () => {
  const r = assessRealness(bare({ startTime: "16:00", endTime: "18:00" }));
  assert.equal(r.suspect, false);
});

check("bare OPEN-until-close window (start known, no end) goes LIVE", () => {
  const r = assessRealness(bare({ startTime: "15:00", endTime: null }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("OPERATING HOURS: bare 11am–10pm (11h) span IS suspect (Wandering Tortoise shape)", () => {
  const r = assessRealness(bare({ startTime: "11:00", endTime: "22:00" }));
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("bare_non_hh_window"));
});

check("OPERATING HOURS veto: a long bare span that SAYS happy hour stays LIVE", () => {
  const r = assessRealness(bare({ startTime: "11:00", endTime: "22:00", notes: "All-day Happy Hour" }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("DAYTIME/LUNCH: bare 10am–2pm menu-page window IS suspect (Original Joe's)", () => {
  const r = assessRealness(bare({ startTime: "10:00", endTime: "14:00", sourceUrl: "https://originaljoes.com/menu" }));
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("bare_non_hh_window"));
});

check("DAYTIME/LUNCH: bare 11:30am–3pm window IS suspect (Giuseppe's /about)", () => {
  const r = assessRealness(bare({ startTime: "11:30", endTime: "15:00" }));
  assert.ok(r.reasons.includes("bare_non_hh_window"));
});

check("DAYTIME/LUNCH veto: a bare midday window that SAYS happy hour stays LIVE", () => {
  const r = assessRealness(bare({ startTime: "12:00", endTime: "15:00", notes: "Happy Hour Mon–Fri 12–3pm" }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

// Veto coverage — HH_RE clears the bare-window gate on the window's OWN NOTES (any wording).
// A shared page-URL slug does NOT veto (REVERSED 2026-06-14, La Herradura leak).
check("REVERSED: a long bare span from a /happy-hour page URL IS operating hours (slug not per-window proof)", () => {
  const r = assessRealness(bare({ startTime: "11:00", endTime: "22:00", sourceUrl: "https://example.com/happy-hour" }));
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("bare_non_hh_window"));
});

check("VETO (notes): a long bare span whose NOTES say happy hour stays LIVE", () => {
  const r = assessRealness(bare({ startTime: "11:00", endTime: "22:00", notes: "All-day Happy Hour" }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("VETO ('social hour'): a daytime bare span worded 'Social Hour' stays LIVE", () => {
  const r = assessRealness(bare({ startTime: "11:00", endTime: "15:00", notes: "Social Hour 11–3" }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("VETO (North Italia notes): bare span with 'happy hour' notes stays LIVE", () => {
  const r = assessRealness(bare({ startTime: "11:00", endTime: "18:00", notes: "Happy Hour Mon–Fri 3–6pm in the bar" }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("NOT LUNCH: bare 2–4pm afternoon HH stays LIVE (start past noon floor)", () => {
  const r = assessRealness(bare({ startTime: "14:00", endTime: "16:00" }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("exactly 6h bare span (15:00–21:00) IS suspect (boundary, operating-day length)", () => {
  const r = assessRealness(bare({ startTime: "15:00", endTime: "21:00" }));
  assert.ok(r.reasons.includes("bare_non_hh_window"));
});

check("just under 6h bare span (15:00–20:30) goes LIVE", () => {
  const r = assessRealness(bare({ startTime: "15:00", endTime: "20:30" }));
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
});

check("a window WITH offerings is never a bare phantom (even with no HH wording)", () => {
  const r = assessRealness({
    allDay: false, dayCount: 5, timeKnown: true, confidence: 0.9,
    mealSpecial: { startTime: "16:00", endTime: "18:00", notes: null, sourceUrl: "https://x.com/menu", offerings: [off("Draft beer", 5)] },
  });
  assert.equal(r.reasons.includes("bare_non_hh_window"), false);
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

// ── implausible duration WITHOUT a midnight crossing (Brothers Pizza, 2026-07-06) ───
// "00:00 → 21:30" never crosses midnight (21:30 >= 00:00) so the old crossing-only check
// let a 21.5h "happy hour" (really the venue's Mon/Tue operating hours around a slice
// special) straight through. Same-day windows need the same >6h duration check.
check("GOLDEN Brothers Pizza: 00:00→21:30 (21.5h, no midnight crossing) IS suspect", () => {
  const r = dur("00:00", "21:30");
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("implausible_window_duration"));
});
check("a normal same-day window 16:00→18:00 (2h) is NOT a duration problem", () => {
  const r = dur("16:00", "18:00");
  assert.equal(r.reasons.includes("implausible_window_duration"), false);
});
check("an exactly-6h same-day window (11:00→17:00) is allowed (boundary)", () => {
  const r = dur("11:00", "17:00");
  assert.equal(r.reasons.includes("implausible_window_duration"), false);
});
check("a same-day window just over 6h (11:00→17:01) IS suspect (boundary)", () => {
  const r = dur("11:00", "17:01");
  assert.ok(r.reasons.includes("implausible_window_duration"));
});

// ── all-day consistency rescue (Agua Salada: Tue special hidden, Mon shown) ──────
// The hidden Tuesday all-day special (time_known=false → no_time_window) is rescued
// because the venue already shows an all-day deal window. No time is fabricated.
const tueSpecial = { reasons: ["no_time_window"] as RealnessReason[], allDay: true, offeringsCount: 3, dayCount: 1 };
check("rescues a no_time_window all-day special when the venue shows an all-day-deal sibling", () => {
  assert.equal(qualifiesForAllDayConsistencyRescue({ ...tueSpecial, venueHasActiveAllDayDeal: true }), true);
});
check("does NOT rescue when the venue has no live all-day-deal sibling (nothing to be consistent with)", () => {
  assert.equal(qualifiesForAllDayConsistencyRescue({ ...tueSpecial, venueHasActiveAllDayDeal: false }), false);
});
check("does NOT rescue an offering-less all-day window (no deal to recover)", () => {
  assert.equal(qualifiesForAllDayConsistencyRescue({ ...tueSpecial, offeringsCount: 0, venueHasActiveAllDayDeal: true }), false);
});
check("does NOT rescue a broad all-day window (≥3 days reads as regular pricing)", () => {
  assert.equal(qualifiesForAllDayConsistencyRescue({ ...tueSpecial, dayCount: 4, venueHasActiveAllDayDeal: true }), false);
});
check("does NOT rescue when another suspicion also fired (meal_special stands)", () => {
  assert.equal(
    qualifiesForAllDayConsistencyRescue({ ...tueSpecial, reasons: ["no_time_window", "meal_special"] as RealnessReason[], venueHasActiveAllDayDeal: true }),
    false,
  );
});
check("does NOT rescue a window that wasn't hidden for no_time_window at all", () => {
  assert.equal(
    qualifiesForAllDayConsistencyRescue({ ...tueSpecial, reasons: ["low_confidence"] as RealnessReason[], venueHasActiveAllDayDeal: true }),
    false,
  );
});

console.log(`\n${passed} checks passed.`);
