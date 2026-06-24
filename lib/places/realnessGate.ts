/**
 * realnessGate — the cheap, pure-code filter that decides whether a captured
 * happy-hour window looks REAL enough to show publicly, or should be stored but
 * HIDDEN (active=false) for operator review.
 *
 * Design principle (operator directive 2026-05-31): the expensive AI extractor
 * CAPTURES everything it can read and never judges realness. This gate makes the
 * realness call in deterministic code — no AI, no network — so it is fast, free,
 * unit-testable, and re-runnable over already-stored rows after a rule tweak.
 * It NEVER deletes data; it only flips visibility.
 *
 * See docs/superpowers/specs/2026-05-31-capture-everything-realness-filter-design.md.
 */

import { HH_RE } from "@/lib/places/hhText";

/** Below this overall extractor confidence, a window is hidden for review. */
export const MIN_CONFIDENCE = 0.5;

/** The deterministic signals the gate checks. Stable string ids — surfaced in reports. */
export type RealnessReason =
  | "all_day_many_days"
  | "no_time_window"
  | "low_confidence"
  | "meal_special"
  | "bare_non_hh_window"
  | "implausible_window_duration";

export interface RealnessInput {
  /** Window runs the full open hours of its days (no clock window). */
  allDay: boolean;
  /** How many ISO weekdays this window covers. */
  dayCount: number;
  /** Did we capture a usable time bound (a start, an end, or an explicit all-day claim)? */
  timeKnown: boolean;
  /** Extract-level overall confidence (0..1) that the schedule is current/accurate. */
  confidence: number;
  /** Offerings + window context for the meal-special rule; omit to skip that rule
   *  (older callers keep their exact previous behavior). */
  mealSpecial?: MealSpecialInput;
}

export interface RealnessVerdict {
  /** True → store the row HIDDEN (active=false) pending review; false → show it. */
  suspect: boolean;
  /** Which signals fired (empty when not suspect). */
  reasons: RealnessReason[];
}

/**
 * Classify one window. Suspect if ANY signal fires:
 *  - all-day on 3+ days     → almost always regular pricing, not a happy hour
 *  - no usable time at all   → can never be shown as "happening now"
 *  - low overall confidence  → the extractor wasn't sure the schedule is real/current
 *  - bare window spanning an operating day → operating hours, not a deal
 */
export function assessRealness(input: RealnessInput): RealnessVerdict {
  const reasons: RealnessReason[] = [];

  if (input.allDay && input.dayCount >= 3) reasons.push("all_day_many_days");
  // An "all day" window carrying NO offerings and no happy-hour wording asserts nothing
  // usable — it is an extraction artifact (an image misread gave Lion's Tale an "all day
  // Monday" window with no deals). Hide it regardless of day count. allDay + offerings, or
  // allDay + "happy hour" in the notes, is real and untouched. HIDES only, never deletes.
  else if (input.allDay && input.mealSpecial && isAllDayBareArtifact(input.mealSpecial)) {
    reasons.push("bare_non_hh_window");
  }
  if (!input.timeKnown) reasons.push("no_time_window");
  // A window with a KNOWN bounded time AND ≥1 offering is concrete evidence the schedule is real
  // — far stronger than the extractor's self-reported confidence. Never bench such a window on
  // low confidence alone (Blanco: conf 0.4 but M–F 3–6pm w/ 20 deals). meal_special / op-hours
  // still apply — those target genuine false positives (a $35 prix-fixe is timed+priced too).
  const concrete = input.timeKnown && (input.mealSpecial?.offerings.length ?? 0) > 0;
  if (input.confidence < MIN_CONFIDENCE && !concrete) reasons.push("low_confidence");
  if (input.mealSpecial && mealSpecialEvidence(input.mealSpecial)) reasons.push("meal_special");
  if (input.mealSpecial && bareWindowSuspect(input.mealSpecial)) reasons.push("bare_non_hh_window");
  if (input.mealSpecial && crossesMidnightImplausible(input.mealSpecial.startTime, input.mealSpecial.endTime)) reasons.push("implausible_window_duration");

  return { suspect: reasons.length > 0, reasons };
}

// ── meal_special — meal services / events stored as happy hours ─────────────────
//
// Born from the 2026-06-12 all-city price scan: ~20 LIVE windows were lunch menus,
// dinner specials, prix fixes, and paint-and-sip events the extractor had captured
// as happy hours. Three deterministic signals, each with near-zero hits on the real
// (upscale) happy hours in the same scan. Like every gate signal this only HIDES
// (active=false) for operator review — it never deletes.

/** Meal-service / event language in an offering name or window notes. */
// Event/format words always fire; meal-period words (lunch/dinner/…) fire UNLESS followed by
// "menu" — "Dinner menu appetizers" cites a menu (a real HH food item), it is not dinner service
// (Trattoria Pina, 2026-06-15). "Dinner Special" still matches.
export const MEAL_SPECIAL_RE =
  /\b(?:prix[- ]?fixe|early[- ]?bird|bottomless|paint\s*(?:and|&|'?n'?)\s*sip|\d+[- ]course)\b|\b(?:lunch(?:eon)?|brunch|breakfast|dinner|supper)\b(?!\s+menus?\b)/i;

/** Above this average offering price a meal-shaped time window becomes suspect
 *  (operator's $12 line, 2026-06-12). Price alone NEVER fires — upscale HH is real. */
export const MEAL_AVG_PRICE_CENTS = 1200;

/** 1–2 priced items all at/above this → combo/entrée pricing, not a deal list. */
export const MEAL_EXPENSIVE_ITEM_CENTS = 3000;

export interface MealSpecialInput {
  /** 24-hour "HH:MM[:SS]" or null. */
  startTime: string | null;
  endTime: string | null;
  /** Extractor notes on the window. */
  notes?: string | null;
  /** Page the window was extracted from. */
  sourceUrl?: string | null;
  offerings: Array<{
    name: string | null;
    description?: string | null;
    priceCents: number | null;
  }>;
}

function toMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Why this window looks like meal service rather than a happy hour, or null when it
 * doesn't. The string is operator-facing — surfaced verbatim in review reports so a
 * hide is never unexplained. Signals (ANY fires):
 *
 *   1. meal-service language — prix fixe / lunch / brunch / dinner / early-bird /
 *      bottomless / paint-and-sip / N-course in an offering name or the notes
 *   2. meal-shaped clock window (lunch ≤12:00→≤16:00, or dinner ≥17:00→≥21:00)
 *      AND average offering price above $12 — either alone is common in real HH
 *   3. only 1–2 priced items, ALL ≥ $30 — combo/entrée pricing, not a deal list
 *
 * Veto: explicit happy-hour text anywhere (offering names, notes, source URL) clears
 * all signals — a venue calling it a happy hour is evidence we keep (the D.Monaghans
 * precedent from the hidden-window review).
 */
export function mealSpecialEvidence(input: MealSpecialInput): string | null {
  const offeringText = input.offerings
    .map((o) => `${o.name ?? ""} ${o.description ?? ""}`)
    .join(" | ");
  const windowText = `${offeringText} ${input.notes ?? ""}`;
  // Two veto scopes (La Herradura vs Vix Creek, 2026-06-15):
  //  - ownVeto — the window's OWN text (offering names/descriptions + notes) says "happy hour".
  //    The venue calls THIS window a happy hour → clears every signal.
  //  - urlVeto — only the source URL slug says happy hour (a "/happy-hours-specials" landing
  //    page or "HappyHour-Menu.pdf"). A page slug is shared by every row scraped off that page,
  //    so it clears the AMBIGUOUS signals (price + timing) but NOT an explicit meal-period TOKEN
  //    in the offering itself: "Breakfast Special" on a happy-hours page is still breakfast
  //    (La Herradura). This keeps real HH menus live (Vix Creek's $11 food list off a
  //    HappyHour-Menu.pdf) while hiding tokened meal rows swept onto a happy-hours landing page.
  const ownVeto = HH_RE.test(windowText);
  if (ownVeto) return null;
  const urlVeto = HH_RE.test(input.sourceUrl ?? "");

  const evidence: string[] = [];

  // Meal-period TOKEN — not URL-vetoable (an explicit "Dinner Special" is a meal, page slug aside).
  const token = MEAL_SPECIAL_RE.exec(windowText);
  if (token) evidence.push(`meal-service language ("${token[0]}")`);

  // Ambiguous price/timing signals — a happy-hour source URL clears these (a HH menu legitimately
  // carries upscale items and midday windows).
  if (!urlVeto) {
    const priced = input.offerings
      .map((o) => o.priceCents)
      .filter((p): p is number => p != null && p > 0);
    const avg = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;
    const start = toMinutes(input.startTime);
    const end = toMinutes(input.endTime);

    // end > start excludes crosses-midnight windows — late-night HH is real.
    if (avg != null && avg > MEAL_AVG_PRICE_CENTS && start != null && end != null && end > start) {
      const fmtAvg = `avg $${(avg / 100).toFixed(2)}`;
      if (start <= 12 * 60 && end <= 16 * 60) {
        evidence.push(`lunch-hours window with ${fmtAvg}`);
      } else if (start >= 17 * 60 && end >= 21 * 60) {
        evidence.push(`dinner-service window with ${fmtAvg}`);
      }
    }

    // Time-only lunch-band (operator 2026-06-14): a window wholly in lunch hours (start 11:00–14:00,
    // end ≤ 16:00) carrying menu items is almost always a lunch menu, even when cheap or unpriced
    // (so the $12 rule above misses it). Requires ≥1 offering (empty windows are the bare-window
    // gate's job). The ownVeto above protects genuine midday happy hours ("Mon–Fri 12–3 happy hour").
    if (
      input.offerings.length >= 1 &&
      start != null && end != null && end > start &&
      start >= 11 * 60 && start <= 14 * 60 && end <= 16 * 60
    ) {
      evidence.push("midday lunch-hours window (no happy-hour wording)");
    }

    if (
      priced.length >= 1 &&
      priced.length <= 2 &&
      Math.min(...priced) >= MEAL_EXPENSIVE_ITEM_CENTS
    ) {
      evidence.push(
        `only ${priced.length} priced item${priced.length === 1 ? "" : "s"}, all ≥ $${MEAL_EXPENSIVE_ITEM_CENTS / 100} (combo/entrée pricing)`,
      );
    }
  }

  return evidence.length ? evidence.join("; ") : null;
}

// ── bare-window gate — TIME-FIRST (operator directive 2026-06-14) ───────────────
//
// REVERSES the 2026-06-13 rule that hid every offering-less window. Operator policy:
// a CONFIRMED bounded time is enough to go live, even with no published food/drink
// ("if time, show it live"). Two weeks of real happy hours (Super Duper's M–F 4–6pm)
// were benched as "bare" — that recall loss is worse than the occasional menu-page
// false positive. So a bare window is suspect ONLY when its clock span covers most of
// an operating day (≥ BARE_OPERATING_HOURS_MIN) AND carries no happy-hour wording —
// i.e. it is operating hours, not a deal (Wandering Tortoise's 11am–11pm blob). The
// HH_RE veto still keeps any bare window that says "happy hour". The reconcile gate
// (isOperatingHours) is the authoritative op-hours check when hours_json exists; this
// duration test is the backstop for venues with no hours data. HIDES only, never deletes.

/** A bare window this long or longer (no offerings, no HH wording) reads as operating
 *  hours rather than a happy hour. 6h: a 3–8pm deal (5h) still shows; an 11am–10pm span
 *  does not. */
export const BARE_OPERATING_HOURS_MIN = 6 * 60;

/** A bare window that starts by this time AND ends by BARE_DAYTIME_END is a daytime/lunch
 *  menu, not a happy hour (Original Joe's 10am–2pm, Giuseppe's 11:30–3pm captured off a
 *  /menu page). Afternoon HH (starts 2pm+) is past this floor and still shows. */
export const BARE_DAYTIME_START_MAX = 12 * 60; // noon
export const BARE_DAYTIME_END = 16 * 60; // 4pm

/**
 * A window whose stored clock crosses midnight (end < start) with an implausibly long
 * wrap-around span (> 6h). Real late-night HH that crosses midnight is short (11pm–2am);
 * a 23:00→14:00 "window" is a parse error (The Backyard's "11pm–2pm", diagnosis bucket
 * #3). > 6h, so a generous 9pm–3am still passes; only absurd spans hide.
 */
function crossesMidnightImplausible(startTime: string | null, endTime: string | null): boolean {
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  if (s == null || e == null || e >= s) return false; // not a crossing window
  return e + 24 * 60 - s > 6 * 60;
}

/** True when a bare window (no offerings, no HH wording) does NOT look like a happy hour:
 *  it either spans most of an operating day (operating hours) or sits in the daytime/lunch
 *  band (a menu). A bounded, afternoon/evening, HH-length bare window is NOT suspect —
 *  confirmed time alone is enough to show it (operator directive 2026-06-14). Open-until-close
 *  (start known, no end) counts as confirmed. The HH_RE veto keeps anything that says
 *  "happy hour" regardless of shape. */
/** An all-day window with no offerings and no "happy hour" wording — an extraction artifact
 *  (no time, no deal, no HH claim). The notes-only veto mirrors bareWindowSuspect: a shared
 *  page-URL slug does not make a contentless all-day window a happy hour. */
export function isAllDayBareArtifact(input: MealSpecialInput): boolean {
  if (input.offerings.length > 0) return false;
  return !HH_RE.test(input.notes ?? "");
}

export function bareWindowSuspect(input: MealSpecialInput): boolean {
  if (input.offerings.length > 0) return false; // has deals → judged elsewhere
  // Veto on the window's OWN wording (notes) only, not the shared page-URL slug — see the
  // mealSpecialEvidence note: a "/happy-hours" landing page does not make every bare window
  // on it a happy hour.
  if (HH_RE.test(input.notes ?? "")) return false; // says "happy hour" → keep, whatever the shape
  const start = toMinutes(input.startTime);
  const end = toMinutes(input.endTime);
  if (start == null || end == null || end <= start) return false; // unbounded/open-close/crossing
  if (end - start >= BARE_OPERATING_HOURS_MIN) return true; // spans an operating day
  if (start <= BARE_DAYTIME_START_MAX && end <= BARE_DAYTIME_END) return true; // daytime/lunch menu
  return false;
}

/**
 * The shared "should this window be shown publicly?" decision, consolidating the two
 * suspicion signals so every persist path agrees:
 *   - `realnessSuspect` — the realness gate flagged it (assessRealness().suspect), and
 *   - `freeSuspect`     — the free deterministic parser flagged it implausible
 *                         (ExtractedHappyHour.suspect; absent for paid-extractor windows).
 * A window goes live ONLY if BOTH are clear. Callers with extra gates (e.g. the
 * reconcile gate) AND their result on top.
 */
export function windowShouldBeActive(input: {
  realnessSuspect: boolean;
  freeSuspect?: boolean;
}): boolean {
  return !input.realnessSuspect && !input.freeSuspect;
}
