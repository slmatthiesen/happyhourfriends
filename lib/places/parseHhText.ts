/**
 * parseHhText — DETERMINISTIC happy-hour text → structured windows. NO AI, $0.
 *
 * Conservative by design (PRD §13: never fabricate): a window is only `clean`
 * (safe to auto-write) when it has happy-hour/deal context AND resolved days AND a
 * concrete time bound. Everything else is `fuzzy` — the caller escalates it to the
 * paid extractor rather than guessing. Used by lib/ai/freeExtract.ts.
 */
import { HH_RE } from "@/lib/places/hhText";

export interface ParsedOffering {
  kind: "food" | "drink" | "other";
  category: string;
  name: string;
  priceCents: number | null;
  discountCents: number | null;
  sourceUrl: string;
}
export interface ParsedWindow {
  daysOfWeek: number[];
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  timeKnown: boolean;
  locationWithinVenue: "all";
  notes: string | null;
  offerings: ParsedOffering[];
  confidence: "clean" | "fuzzy";
  /**
   * Structural plausibility flag. `false` means a downstream adapter should hide
   * this window for operator review rather than publishing it:
   *   1. Duration > 6 hours (both times known, cross-midnight-aware).
   *   2. Degenerate: both times known AND duration ≤ 0 (start == end).
   *   3. Weak evidence: only a deal word matched (not HH_RE) AND days were assumed.
   * `fuzzy` windows are always `false` (they're never auto-written anyway).
   */
  plausible: boolean;
  evidence: string;
  sourceUrl: string;
}

const DAY: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};
const DAY_NAMES = "(mon(?:day)?|tues?(?:day)?|wed(?:s|nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
// Word-bound so "monitor", "sunny", "satisfaction" etc. don't match a day name.
const DAY_TOKEN = `\\b${DAY_NAMES}\\b`;

function expandDayRange(a: number, b: number): number[] {
  // ISO week Mon..Sun; wrap (e.g. Sun→Thu = 7,1,2,3,4).
  const out: number[] = [];
  let d = a;
  for (let i = 0; i < 7; i++) {
    out.push(d);
    if (d === b) break;
    d = d === 7 ? 1 : d + 1;
  }
  return out;
}

/** Resolve the day set named in a snippet, or null if none stated. */
export function parseDays(s: string): number[] | null {
  const t = s.toLowerCase();
  if (/\b(daily|every\s*day|all\s*week|7\s*days)\b/.test(t)) return [1, 2, 3, 4, 5, 6, 7];
  if (/\bweekend(s)?\b/.test(t)) return [6, 7];
  if (/\bweekday(s)?\b/.test(t)) return [1, 2, 3, 4, 5];
  // range: "mon-fri", "monday through friday", "tue to thu"
  const range = new RegExp(`${DAY_TOKEN}\\s*(?:-|–|—|to|through|thru|until|till)\\s*${DAY_TOKEN}`, "i").exec(t);
  if (range) {
    const a = DAY[range[1].replace(/[^a-z]/g, "")];
    const b = DAY[range[2].replace(/[^a-z]/g, "")];
    if (a && b) return expandDayRange(a, b).sort((x, y) => x - y);
  }
  // explicit list / singletons: "mon, wed & fri", "saturday"
  const found = new Set<number>();
  const re = new RegExp(DAY_TOKEN, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const d = DAY[m[1].toLowerCase().replace(/[^a-z]/g, "")];
    if (d) found.add(d);
  }
  return found.size > 0 ? [...found].sort((x, y) => x - y) : null;
}

/**
 * "HH:MM" from hour (1-12 or 0-23), minutes, optional meridiem — or `null` when the
 * resolved time is not a valid wall-clock value. INVALID when, after resolving the
 * meridiem to 24h: hour < 0, hour > 23, or minute > 59. Also: when a meridiem was
 * explicitly written, the RAW hour must be 1–12 ("38pm" is nonsense). This is what
 * rejects price/quantity ranges that leaked into the time regex (38:00, 80:00, 99:00…).
 */
function clock(h: number, min: number, mer: "am" | "pm" | null): string | null {
  if (min > 59) return null;
  // A written meridiem constrains the raw hour to 1..12.
  if (mer !== null && (h < 1 || h > 12)) return null;
  let hr = h;
  if (mer === "pm" && hr < 12) hr += 12;
  if (mer === "am" && hr === 12) hr = 0;
  if (hr < 0 || hr > 23) return null;
  return `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// `(?<![$\d.])` so a digit preceded by `$` (a price, incl. "$ 5" → see normalize step),
// a decimal (`3.5`), or another digit (mid-number) is NOT read as an hour.
// `(?!\d)` so `\d{1,2}` never grabs only part of a longer run (years, phones, "$14"→"14").
const TIME = "(?<![$\\d.])(\\d{1,2})(?!\\d)(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?";
const SEP = "\\s*(?:-|–|—|to|til|till|until|through|thru)\\s*";
const CLOSE = "(close|closing|midnight|late|end)";

interface TimeRange {
  startTime: string | null;
  endTime: string | null;
  /** True when NEITHER end stated am/pm and the meridiem was inferred for both. */
  meridiemInferred: boolean;
}

/**
 * Parse one time range. hhContext enables pm-inference when no meridiem is written
 * (happy hours run afternoon/evening). Returns null when no usable range is present.
 */
export function parseTimeRange(s: string, hhContext: boolean): TimeRange | null {
  const t = s.toLowerCase();
  const mer = (x: string | undefined): "am" | "pm" | null =>
    x ? (x[0] === "p" ? "pm" : "am") : null;

  // "open until 6pm" / "from open to 6pm"
  const openTo = new RegExp(`\\bopen(?:ing)?\\b${SEP}${TIME}`, "i").exec(t);
  if (openTo) {
    const stated = mer(openTo[3]);
    const e = clock(+openTo[1], openTo[2] ? +openTo[2] : 0, stated ?? (hhContext ? "pm" : null));
    if (e === null) return null;
    return { startTime: null, endTime: e, meridiemInferred: !stated };
  }
  // "9pm - close"
  const toClose = new RegExp(`${TIME}${SEP}${CLOSE}`, "i").exec(t);
  if (toClose) {
    const stated = mer(toClose[3]);
    let sm = stated;
    if (!sm && hhContext && +toClose[1] >= 1 && +toClose[1] <= 11) sm = "pm";
    const s = clock(+toClose[1], toClose[2] ? +toClose[2] : 0, sm);
    if (s === null) return null;
    return { startTime: s, endTime: null, meridiemInferred: !stated };
  }
  // "3pm - 7pm" / "3 - 7pm" / "3-7"
  const range = new RegExp(`${TIME}${SEP}${TIME}`, "i").exec(t);
  if (range) {
    let sMer = mer(range[3]);
    let eMer = mer(range[6]);
    const inferred = !sMer && !eMer; // neither end carried a meridiem
    if (!sMer && eMer) sMer = eMer;            // "3-7pm" → both pm
    if (sMer && !eMer) eMer = sMer;
    if (!sMer && !eMer && hhContext) { sMer = "pm"; eMer = "pm"; } // "3-7" under HH
    const start = clock(+range[1], range[2] ? +range[2] : 0, sMer);
    const end = clock(+range[4], range[5] ? +range[5] : 0, eMer);
    // Either endpoint invalid (price/quantity/year leak, minute overflow, pm-inference
    // overflow like "21"→33) → reject the whole range, emit no window.
    if (start === null || end === null) return null;
    return { startTime: start, endTime: end, meridiemInferred: inferred };
  }
  return null;
}

const DRINK = /(beer|draft|draught|wine|cocktail|martini|margarita|spirit|well|pint|sangria|mimosa|shot|liquor|whiskey|tequila|vodka|drink)/i;
const FOOD = /(appetizer|app|wing|taco|burger|slider|nacho|pizza|fries|oyster|sandwich|plate|small plate|bite|food)/i;

// Label = up to 4 short words; stops at punctuation/digits so it can't swallow
// trailing prose ("$5 wings during the game and ..." → just "wings").
const LABEL = "([a-z][a-z'/-]*(?:\\s+[a-z][a-z'/-]*){0,3})?";

function categorize(ctx: string, kind: ParsedOffering["kind"]): string {
  return (
    /beer|draft|draught|pint/i.test(ctx) ? "beer" :
    /wine|sangria/i.test(ctx) ? "wine" :
    /cocktail|martini|margarita|mimosa/i.test(ctx) ? "cocktail" :
    /spirit|well|liquor|whiskey|tequila|vodka|shot/i.test(ctx) ? "spirit" :
    kind === "food" ? "appetizer" : "other"
  );
}

/**
 * Duration in minutes between two "HH:MM" strings, cross-midnight aware.
 * If end < start (cross-midnight), adds 1440 minutes before subtracting.
 * Returns null if either string is falsy.
 */
function durationMinutes(startTime: string, endTime: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m ?? 0);
  };
  const s = toMin(startTime);
  const e = toMin(endTime);
  return e < s ? e + 1440 - s : e - s;
}

/**
 * Compute the structural plausibility of a window.
 * `isClean` is false → plausible is always false (fuzzy windows are never auto-written).
 * `hhMatched` — whether HH_RE matched the segment (vs only a deal word).
 * `daysAssumed` — whether days were assumed (no days stated in the segment).
 */
function computePlausible(
  isClean: boolean,
  startTime: string | null,
  endTime: string | null,
  hhMatched: boolean,
  daysAssumed: boolean,
): boolean {
  if (!isClean) return false;

  // Signal 1 & 2: both times known — check duration.
  if (startTime !== null && endTime !== null) {
    const dur = durationMinutes(startTime, endTime);
    if (dur <= 0) return false;   // degenerate (start == end)
    if (dur > 360) return false;  // > 6 hours
  }

  // Signal 3: only a deal word matched (not HH_RE) AND days were assumed.
  if (!hhMatched && daysAssumed) return false;

  return true;
}

/** Best-effort offerings from a snippet: "$N off X", "$N Y", "half-price Z". */
export function parseOfferings(s: string, sourceUrl: string): ParsedOffering[] {
  const out: ParsedOffering[] = [];

  // "$N off X" / "$N Y" — dollar-priced or dollar-discounted items.
  const dollar = new RegExp(`\\$(\\d+(?:\\.\\d{2})?)\\s*(off)?\\s*${LABEL}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = dollar.exec(s)) !== null) {
    const cents = Math.round(parseFloat(m[1]) * 100);
    const isOff = !!m[2];
    const label = (m[3] ?? "").trim();
    const ctx = `${label} ${s}`;
    const kind: ParsedOffering["kind"] = DRINK.test(ctx) ? "drink" : FOOD.test(ctx) ? "food" : "other";
    out.push({
      kind,
      category: categorize(ctx, kind),
      name: (m[0] || "").replace(/\s+/g, " ").trim(),
      priceCents: isOff ? null : cents,
      discountCents: isOff ? cents : null,
      sourceUrl,
    });
    if (out.length >= 8) break;
  }

  // "half price X" / "half-price X" / "1/2 off X" — percentage discounts (no $ amount).
  const half = new RegExp(`(half[-\\s]?price|1/2\\s*(?:off|price))\\s*${LABEL}`, "gi");
  while (out.length < 8 && (m = half.exec(s)) !== null) {
    const label = (m[2] ?? "").trim();
    const ctx = `${label} ${s}`;
    const kind: ParsedOffering["kind"] = DRINK.test(ctx) ? "drink" : FOOD.test(ctx) ? "food" : "other";
    out.push({
      kind,
      category: categorize(ctx, kind),
      name: (m[0] || "").replace(/\s+/g, " ").trim(),
      priceCents: null,
      discountCents: null,
      sourceUrl,
    });
  }

  return out;
}

// Deal WORDS only — the genuine "this clause is about a deal" signal. We deliberately
// do NOT reuse DEAL_RE here: its bare time-range alternative (any "\d-\dpm") would make
// EVERY clause with a time range look like a deal, defeating per-segment scoping (a plain
// brunch/lunch time range would self-qualify). HH_RE handles "happy hour" explicitly.
const DEAL_WORDS_RE = /\bspecials?\b|drink\s*deals?|\bdaily\b|industry\s*night|happy\s*hr\b/i;

/** True when THIS clause genuinely reads as happy-hour / deal context. */
function isHhContext(segment: string): boolean {
  return HH_RE.test(segment) || DEAL_WORDS_RE.test(segment);
}

// One time-range / to-close / open-to occurrence — used to find ALL ranges per segment.
const RANGE_RE = new RegExp(
  `(?:${TIME}${SEP}(?:${TIME}|${CLOSE}))|\\bopen(?:ing)?\\b${SEP}${TIME}`,
  "gi",
);
// Strong clause/sentence boundaries ONLY: ". " ; · ! newline, and the bullet " · ".
// NOT "and" and NOT a bare comma — a single segment may share one day spec across
// several time ranges (e.g. "3-6pm and 9pm-close, Mon-Fri").
const SEGMENT_SPLIT = /(?:\.(?=\s)|[;·!\n\r])+/;

/**
 * Split text into clause-level segments, then parse each INDEPENDENTLY so happy-hour
 * context + day spec never bleed from an adjacent clause (brunch/kitchen hours).
 */
export function parseHappyHours(text: string, sourceUrl: string): ParsedWindow[] {
  if (!text || !text.trim()) return [];
  // Normalize "a.m."/"p.m." (with or without internal space) to "am"/"pm" BEFORE
  // segment-splitting — otherwise the period in "3 p.m. - 6 p.m." triggers SEGMENT_SPLIT
  // and severs the time range across segments, causing the window to be dropped.
  const norm = text
    .replace(/\b([ap])\.\s?m\.?/gi, "$1m")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    // Collapse "$ 5" → "$5" so the price lookbehind on the time digit fires.
    .replace(/\$\s+(?=\d)/g, "$");
  const out: ParsedWindow[] = [];
  const seen = new Set<string>();

  for (const rawSeg of norm.split(SEGMENT_SPLIT)) {
    const segment = rawSeg.trim();
    if (!segment) continue;

    // Context + days are scoped to THIS segment only.
    const hhContext = isHhContext(segment);
    // Track whether the segment matched HH_RE explicitly (vs only a deal word).
    const hhMatched = HH_RE.test(segment);
    const segDays = parseDays(segment);

    // Find ALL time ranges in the segment; emit one window per range.
    RANGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RANGE_RE.exec(segment)) !== null) {
      if (m[0].length === 0) { RANGE_RE.lastIndex++; continue; }
      const range = parseTimeRange(m[0], hhContext);
      if (!range) continue;

      let days = segDays;
      let notes: string | null = null;
      // Track whether days were assumed (none stated in text).
      const daysAssumed = !segDays && hhContext;
      if (daysAssumed) { days = [1, 2, 3, 4, 5]; notes = "days assumed Mon–Fri (none stated)"; }

      const timeKnown = !!(range.startTime || range.endTime);
      // Guard: a range whose meridiem was inferred for BOTH ends and that inverts
      // (start > end) is not a valid window — never mark it clean (bug 3).
      const invertedInfer =
        range.meridiemInferred &&
        range.startTime !== null &&
        range.endTime !== null &&
        range.startTime > range.endTime;
      const isClean = hhContext && !!days && timeKnown && !invertedInfer;

      const key = `${(days ?? []).join(",")}|${range.startTime}|${range.endTime}|${isClean ? "c" : "f"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const plausible = computePlausible(isClean, range.startTime, range.endTime, hhMatched, daysAssumed);

      out.push({
        daysOfWeek: days ?? [],
        allDay: false,
        startTime: range.startTime,
        endTime: range.endTime,
        timeKnown,
        locationWithinVenue: "all",
        notes,
        offerings: isClean ? parseOfferings(segment, sourceUrl) : [],
        confidence: isClean ? "clean" : "fuzzy",
        plausible,
        evidence: segment,
        sourceUrl,
      });
    }
  }
  return out;
}
