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
  /** True when no days were stated in the text and Mon–Fri was inferred. */
  daysAssumed: boolean;
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
  /**
   * True when at least one endpoint wrote an explicit am/pm (or was unambiguously
   * 24-hour, i.e. hour ≥ 13). False means the whole range used bare numbers only.
   */
  hadExplicitMeridiem: boolean;
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
    return { startTime: null, endTime: e, meridiemInferred: !stated, hadExplicitMeridiem: !!stated };
  }
  // "9pm - close"
  const toClose = new RegExp(`${TIME}${SEP}${CLOSE}`, "i").exec(t);
  if (toClose) {
    const stated = mer(toClose[3]);
    const rawH = +toClose[1];
    // Unambiguously 24h (≥13) → don't force pm; use raw hour as-is (no meridiem).
    const is24h = !stated && rawH >= 13;
    let sm = stated;
    if (!sm && !is24h && hhContext && rawH >= 1 && rawH <= 11) sm = "pm";
    const s = clock(rawH, toClose[2] ? +toClose[2] : 0, sm);
    if (s === null) return null;
    // hadExplicitMeridiem tracks ONLY written am/pm tokens, not 24h inference.
    return { startTime: s, endTime: null, meridiemInferred: !stated && !is24h, hadExplicitMeridiem: !!stated };
  }
  // "3pm - 7pm" / "3 - 7pm" / "3-7"
  const range = new RegExp(`${TIME}${SEP}${TIME}`, "i").exec(t);
  if (range) {
    let sMer = mer(range[3]);
    let eMer = mer(range[6]);
    const inferred = !sMer && !eMer; // neither end carried a meridiem
    const sRawH = +range[1];
    const eRawH = +range[4];
    // Either endpoint ≥13 → unambiguously 24h; leave both meridiems null so clock()
    // treats the value as a raw 24h hour. Don't apply pm-inference in this case.
    const is24h = !sMer && !eMer && (sRawH >= 13 || eRawH >= 13);
    if (!is24h) {
      if (!sMer && eMer) sMer = eMer;           // "3-7pm" → both pm
      if (sMer && !eMer) eMer = sMer;
      if (!sMer && !eMer && hhContext) { sMer = "pm"; eMer = "pm"; } // "3-7" under HH
    }
    const start = clock(sRawH, range[2] ? +range[2] : 0, sMer);
    const end = clock(eRawH, range[5] ? +range[5] : 0, eMer);
    // Either endpoint invalid (price/quantity/year leak, minute overflow, pm-inference
    // overflow like "21"→33) → reject the whole range, emit no window.
    if (start === null || end === null) return null;
    // hadExplicitMeridiem: true only when the user wrote an am/pm token; 24h bare
    // numbers do NOT count as explicit meridiem for the plausibility signal.
    const hadExplicitMeridiem = !!(mer(range[3]) || mer(range[6]));
    return { startTime: start, endTime: end, meridiemInferred: inferred, hadExplicitMeridiem };
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
 * Compute the structural plausibility of a window — i.e. is it safe to show LIVE, or
 * should it be captured HIDDEN for operator review?
 * `isClean` is false → plausible is always false (fuzzy windows are never auto-written).
 * `hhMatched` — whether the literal "happy hour" (HH_RE) appears in THIS window's segment.
 *
 * Precision gate (validated against real Tacoma/Daly City pages): a window only goes LIVE
 * when "happy hour" sits in its own segment. A restaurant's dining page routinely lists
 * breakfast/lunch/dinner service hours AND a real happy hour together; a page-level "does
 * the site mention happy hour" check keeps ALL of them, so the only thing that isolates the
 * real window from the service-hours noise is same-segment adjacency. Deal-word-only context
 * (daily/specials) is NOT enough for live → those land in review.
 */
function computePlausible(
  isClean: boolean,
  startTime: string | null,
  endTime: string | null,
  hhMatched: boolean,
): boolean {
  if (!isClean) return false;

  // Duration sanity: drop degenerate and business-hours-shaped windows.
  if (startTime !== null && endTime !== null) {
    const dur = durationMinutes(startTime, endTime);
    if (dur <= 0) return false;   // degenerate (start == end)
    if (dur > 360) return false;  // > 6 hours — almost always operating hours, not HH
  }

  // Precision gate: live requires the literal "happy hour" next to the time. Everything
  // else clean (deal-word-only, bare numbers, menu/service hours) → hidden for review.
  if (!hhMatched) return false;

  return true;
}

// "$N" or a "$N-M" range (price ranges are real on HH menus: "apps from $10-12").
const PRICE = "\\$(\\d+(?:\\.\\d{2})?)(?:\\s*[-–—]\\s*\\$?(\\d+(?:\\.\\d{2})?))?";
// Trailing prepositions/articles a greedy LABEL drags in ("select drafts apps FROM").
const LABEL_TRAILING_STOPWORD = /\s+(?:from|with|and|or|to|at|in|on|per|until|till|the|a|an|of|for)$/i;
function trimLabel(label: string): string {
  let l = label.trim();
  for (let prev = ""; prev !== l; ) { prev = l; l = l.replace(LABEL_TRAILING_STOPWORD, ""); }
  return l;
}
/**
 * kind + category from the item's OWN label when it carries a food/drink word; the
 * whole segment is only a fallback. Segment-level context misfiled every item on a
 * mixed deal list ("$8 wines" categorized beer because "drafts" appeared later).
 */
function kindAndCategory(label: string, segment: string): { kind: ParsedOffering["kind"]; category: string } {
  const primary = label && (DRINK.test(label) || FOOD.test(label)) ? label : segment;
  const kind: ParsedOffering["kind"] = DRINK.test(primary) ? "drink" : FOOD.test(primary) ? "food" : "other";
  return { kind, category: categorize(primary, kind) };
}

/** Best-effort offerings from a snippet: "$N off X", "$N(-M) Y", "X from $N(-M)", "half-price Z". */
export function parseOfferings(s: string, sourceUrl: string): ParsedOffering[] {
  const out: ParsedOffering[] = [];
  // Spans consumed by the label-BEFORE-price form, so the $-first pass neither re-reads
  // their price as an orphan item nor lets its greedy LABEL swallow their label.
  const spans: [number, number][] = [];
  let m: RegExpExecArray | null;

  // "X from $N(-M)" — label-before-price ("apps from $10-12"). The single-word label
  // must itself be a food/drink word so prose like "starting from $10" never matches.
  const labelFrom = new RegExp(`\\b([a-z][a-z'/-]*)\\s+from\\s+${PRICE}`, "gi");
  while (out.length < 8 && (m = labelFrom.exec(s)) !== null) {
    const label = m[1];
    if (!DRINK.test(label) && !FOOD.test(label)) continue;
    spans.push([m.index, m.index + m[0].length]);
    out.push({
      ...kindAndCategory(label, s),
      name: m[0].replace(/\s+/g, " ").trim(),
      priceCents: Math.round(parseFloat(m[2]) * 100), // range → its minimum
      discountCents: null,
      sourceUrl,
    });
  }

  // "$N off X" / "$N Y" / "$N-M Y" — price-first items.
  const dollar = new RegExp(`${PRICE}\\s*(off)?\\s*${LABEL}`, "gi");
  while (out.length < 8 && (m = dollar.exec(s)) !== null) {
    if (spans.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    const cents = Math.round(parseFloat(m[1]) * 100);
    const isOff = !!m[3];
    const rawLabel = m[4] ?? "";
    let label = rawLabel;
    // Truncate a greedy label at the start of any label-from span it runs into.
    if (rawLabel) {
      const labelStart = m.index + m[0].lastIndexOf(rawLabel);
      for (const [a] of spans) {
        if (labelStart < a && labelStart + rawLabel.length > a) label = s.slice(labelStart, a);
      }
    }
    label = trimLabel(label);
    if (!label && !isOff) continue; // a bare price names no item ("$10" left over from a range)
    const priceText = `$${m[1]}${m[2] ? `-${m[2]}` : ""}`;
    out.push({
      ...kindAndCategory(label, s),
      name: `${priceText}${isOff ? " off" : ""}${label ? ` ${label}` : ""}`.trim(),
      priceCents: isOff ? null : cents,
      discountCents: isOff ? cents : null,
      sourceUrl,
    });
  }

  // "half price X" / "half-price X" / "1/2 off X" — percentage discounts (no $ amount).
  const half = new RegExp(`(half[-\\s]?price|1/2\\s*(?:off|price))\\s*${LABEL}`, "gi");
  while (out.length < 8 && (m = half.exec(s)) !== null) {
    const label = trimLabel(m[2] ?? "");
    out.push({
      ...kindAndCategory(label, s),
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
// A bare numeric range followed by one of these nouns is a COUNT, not a time —
// "special 4-6 course meals" (The Switch SLO) parsed as a 16:00–18:00 window. Only
// applied when the range wrote no am/pm; an explicit meridiem always wins.
const QUANTITY_NOUN_AFTER_RE =
  /^\s*(courses?|people|persons?|guests?|items?|oz|ounces?|wines?|beers?|tastings?|seats?|weeks?|months?|years?|miles?|%|percent)\b/i;
// One day EXPRESSION with its position: a keyword (daily/weekends/…) or a run of day
// tokens joined by range/list connectors ("mon-fri", "mon, wed & fri"). Used to bind
// each time range to its NEAREST day spec instead of letting the segment's first day
// spec claim every range ("MON-FRI: 4-9PM SAT-SUN: 6-9PM" bound both to Mon–Fri).
const DAY_EXPR_RE = new RegExp(
  `\\b(?:daily|every\\s*day|all\\s*week|7\\s*days|weekends?|weekdays?)\\b` +
    `|${DAY_TOKEN}(?:\\s*(?:-|–|—|to|through|thru|until|till|,|&|and|\\+|/)\\s*${DAY_TOKEN})*`,
  "gi",
);

/** All day expressions in a segment, with the day set each resolves to. */
function findDayExprs(segment: string): { index: number; days: number[] }[] {
  const out: { index: number; days: number[] }[] = [];
  DAY_EXPR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DAY_EXPR_RE.exec(segment)) !== null) {
    if (m[0].length === 0) { DAY_EXPR_RE.lastIndex++; continue; }
    const days = parseDays(m[0]);
    if (days) out.push({ index: m.index, days });
  }
  return out;
}

/** Days for a range at `at`: nearest preceding day expr, else nearest following. */
function bindDays(exprs: { index: number; days: number[] }[], at: number): number[] | null {
  if (exprs.length === 0) return null;
  let best: { index: number; days: number[] } | null = null;
  for (const e of exprs) {
    if (e.index <= at && (!best || e.index > best.index)) best = e;
  }
  if (best) return best.days;
  // No preceding spec — trailing day spec shared by earlier ranges ("3-6pm …, Mon-Fri").
  return exprs[0].days;
}
// Strong clause/sentence boundaries ONLY: ". " ; · ! newline, and the bullet " · ".
// NOT "and" and NOT a bare comma — a single segment may share one day spec across
// several time ranges (e.g. "3-6pm and 9pm-close, Mon-Fri").
// `!` is an exclamation, not a clause boundary — splitting on it severed "Happy Hour!" from its
// own times ("Happy Hour! Mon–Fri 4–7pm"), leaving the time segment context-less → fuzzy/hidden.
const SEGMENT_SPLIT = /(?:\.(?=\s)|[;·\n\r])+/;

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
    const dayExprs = findDayExprs(segment);

    // Find ALL time ranges in the segment; emit one window per range.
    RANGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RANGE_RE.exec(segment)) !== null) {
      if (m[0].length === 0) { RANGE_RE.lastIndex++; continue; }
      // Bare range + quantity noun ("4-6 course meals") is a count, not a time.
      if (
        !/[ap]\.?m/i.test(m[0]) &&
        QUANTITY_NOUN_AFTER_RE.test(segment.slice(m.index + m[0].length))
      ) continue;
      const range = parseTimeRange(m[0], hhContext);
      if (!range) continue;

      // Live gate is PROXIMITY-based: the literal "happy hour" must sit NEAR this time,
      // not merely somewhere in the segment. SSR/Wix pages with sparse punctuation bundle a
      // real "Happy Hour" mention and the "OPENING HOURS" footer into one giant segment —
      // segment-level matching then mislabels lunch/dinner service hours as live. The window
      // is generous backward (offerings often sit between the phrase and the time, e.g. Side
      // Pony) and tight forward (the phrase rarely follows the time).
      const around = segment.slice(Math.max(0, m.index - 140), m.index + m[0].length + 40);
      const hhNearTime = HH_RE.test(around);

      let days = bindDays(dayExprs, m.index);
      let notes: string | null = null;
      // Track whether days were assumed (none stated in text).
      const daysAssumed = !days && hhContext;
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

      const plausible = computePlausible(isClean, range.startTime, range.endTime, hhNearTime);

      out.push({
        daysOfWeek: days ?? [],
        allDay: false,
        startTime: range.startTime,
        endTime: range.endTime,
        timeKnown,
        locationWithinVenue: "all",
        notes,
        daysAssumed,
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
