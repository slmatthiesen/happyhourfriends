/**
 * parseHhText — DETERMINISTIC happy-hour text → structured windows. NO AI, $0.
 *
 * Conservative by design (PRD §13: never fabricate): a window is only `clean`
 * (safe to auto-write) when it has happy-hour/deal context AND resolved days AND a
 * concrete time bound. Everything else is `fuzzy` — the caller escalates it to the
 * paid extractor rather than guessing. Used by lib/ai/freeExtract.ts.
 */
import { HH_RE, DEAL_RE } from "@/lib/places/hhText";

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
  evidence: string;
  sourceUrl: string;
}

const DAY: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};
const DAY_TOKEN = "(mon(?:day)?|tues?(?:day)?|wed(?:s|nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";

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

/** "HH:MM" from hour (1-12 or 0-23), minutes, optional meridiem. */
function clock(h: number, min: number, mer: "am" | "pm" | null): string {
  let hr = h;
  if (mer === "pm" && hr < 12) hr += 12;
  if (mer === "am" && hr === 12) hr = 0;
  return `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?";
const SEP = "\\s*(?:-|–|—|to|til|till|until|through|thru)\\s*";
const CLOSE = "(close|closing|midnight|late|end)";

interface TimeRange { startTime: string | null; endTime: string | null; }

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
    const e = clock(+openTo[1], openTo[2] ? +openTo[2] : 0, mer(openTo[3]) ?? (hhContext ? "pm" : null));
    return { startTime: null, endTime: e };
  }
  // "9pm - close"
  const toClose = new RegExp(`${TIME}${SEP}${CLOSE}`, "i").exec(t);
  if (toClose) {
    let sm = mer(toClose[3]);
    if (!sm && hhContext && +toClose[1] >= 1 && +toClose[1] <= 11) sm = "pm";
    return { startTime: clock(+toClose[1], toClose[2] ? +toClose[2] : 0, sm), endTime: null };
  }
  // "3pm - 7pm" / "3 - 7pm" / "3-7"
  const range = new RegExp(`${TIME}${SEP}${TIME}`, "i").exec(t);
  if (range) {
    let sMer = mer(range[3]);
    let eMer = mer(range[6]);
    if (!sMer && eMer) sMer = eMer;            // "3-7pm" → both pm
    if (sMer && !eMer) eMer = sMer;
    if (!sMer && !eMer && hhContext) { sMer = "pm"; eMer = "pm"; } // "3-7" under HH
    const start = clock(+range[1], range[2] ? +range[2] : 0, sMer);
    const end = clock(+range[4], range[5] ? +range[5] : 0, eMer);
    return { startTime: start, endTime: end };
  }
  return null;
}

const DRINK = /(beer|draft|draught|wine|cocktail|martini|margarita|spirit|well|pint|draught|sangria|mimosa|shot|liquor|whiskey|tequila|vodka|drink)/i;
const FOOD = /(appetizer|app|wing|taco|burger|slider|nacho|pizza|fries|oyster|sandwich|plate|small plate|bite|food)/i;

/** Best-effort offerings from a snippet: "$N off X", "$N Y", "half-price Z". */
export function parseOfferings(s: string, sourceUrl: string): ParsedOffering[] {
  const out: ParsedOffering[] = [];
  const re = /\$(\d+(?:\.\d{2})?)\s*(off)?\s*([a-z][a-z &/'-]{2,40})?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const cents = Math.round(parseFloat(m[1]) * 100);
    const isOff = !!m[2];
    const label = (m[3] ?? "").trim();
    const ctx = `${label} ${s}`;
    const kind: ParsedOffering["kind"] = DRINK.test(ctx) ? "drink" : FOOD.test(ctx) ? "food" : "other";
    const category =
      /beer|draft|draught|pint/i.test(ctx) ? "beer" :
      /wine|sangria/i.test(ctx) ? "wine" :
      /cocktail|martini|margarita|mimosa/i.test(ctx) ? "cocktail" :
      /spirit|well|liquor|whiskey|tequila|vodka|shot/i.test(ctx) ? "spirit" :
      kind === "food" ? "appetizer" : "other";
    out.push({
      kind, category,
      name: (m[0] || "").replace(/\s+/g, " ").trim(),
      priceCents: isOff ? null : cents,
      discountCents: isOff ? cents : null,
      sourceUrl,
    });
    if (out.length >= 8) break;
  }
  return out;
}

/** Split text into candidate snippets around each time range. */
export function parseHappyHours(text: string, sourceUrl: string): ParsedWindow[] {
  if (!text || !text.trim()) return [];
  const norm = text.replace(/ /g, " ").replace(/\s+/g, " ");
  const out: ParsedWindow[] = [];
  const seen = new Set<string>();

  // Anchor on each time-range or to-close occurrence; build a ±context window around it.
  const anchor = new RegExp(`(?:${TIME}${SEP}(?:${TIME}|${CLOSE}))|\\bopen(?:ing)?\\b${SEP}${TIME}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(norm)) !== null) {
    const i = m.index;
    const evidence = norm.slice(Math.max(0, i - 80), Math.min(norm.length, i + m[0].length + 40)).trim();
    const hhContext = HH_RE.test(evidence) || DEAL_RE.test(evidence);
    const range = parseTimeRange(m[0], hhContext);
    if (!range) continue;

    let days = parseDays(evidence);
    let notes: string | null = null;
    if (!days && hhContext) { days = [1, 2, 3, 4, 5]; notes = "days assumed Mon–Fri (none stated)"; }

    const timeKnown = !!(range.startTime || range.endTime);
    const isClean = hhContext && !!days && timeKnown;
    const key = `${(days ?? []).join(",")}|${range.startTime}|${range.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      daysOfWeek: days ?? [],
      allDay: false,
      startTime: range.startTime,
      endTime: range.endTime,
      timeKnown,
      locationWithinVenue: "all",
      notes,
      offerings: isClean ? parseOfferings(evidence, sourceUrl) : [],
      confidence: isClean ? "clean" : "fuzzy",
      evidence,
      sourceUrl,
    });
  }
  return out;
}
