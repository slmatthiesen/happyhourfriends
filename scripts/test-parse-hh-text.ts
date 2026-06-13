/**
 * Runnable unit checks for parseHappyHours (no test framework in repo).
 * Run: pnpm tsx scripts/test-parse-hh-text.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { parseHappyHours, parseDays, parseOfferings, type ParsedWindow } from "@/lib/places/parseHhText";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
const URL = "https://x.com/hh";
const clean = (ws: ParsedWindow[]) => ws.filter((w) => w.confidence === "clean");
const win = (ws: ParsedWindow[], i = 0) => clean(ws)[i];

// --- POSITIVES (must produce a clean window) ---
check("'Happy Hour: 3pm-7pm daily' → [1..7] 15:00-19:00", () => {
  const w = win(parseHappyHours("Happy Hour: 3pm-7pm daily", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "19:00");
  assert.equal(w.confidence, "clean");
});
check("'Happy Hour 11pm-2am Sunday through Thursday' → Sun-Thu cross-midnight", () => {
  const w = win(parseHappyHours("Happy Hour 11pm-2am Sunday through Thursday", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 7]); // sorted: Mon..Thu + Sun
  assert.equal(w.startTime, "23:00");
  assert.equal(w.endTime, "02:00");
});
check("'Mon-Fri 3pm-6pm' → [1..5]", () => {
  const w = win(parseHappyHours("Happy hour Mon-Fri 3pm-6pm", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "18:00");
});
check("'happy hour 3-7' (no meridiem, HH context) → pm inferred 15:00-19:00", () => {
  const w = win(parseHappyHours("Happy hour 3-7", URL));
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "19:00");
});
check("'Happy hour 9pm-close' → start set, end null", () => {
  const w = win(parseHappyHours("Happy hour 9pm-close daily", URL));
  assert.equal(w.startTime, "21:00");
  assert.equal(w.endTime, null);
  assert.equal(w.timeKnown, true);
});
check("time but NO days + HH context → assume Mon-Fri, note it", () => {
  const w = win(parseHappyHours("Happy hour 4pm-6pm", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.match(w.notes ?? "", /assumed Mon.Fri/i);
});
check("daysAssumed boolean: false when days are stated, true when inferred", () => {
  const stated = win(parseHappyHours("Happy Hour Monday-Friday 4pm-7pm", URL));
  assert.equal(stated.daysAssumed, false);
  const assumed = win(parseHappyHours("Happy hour 4pm-7pm", URL));
  assert.equal(assumed.daysAssumed, true);
});
check("attached offering parsed: '$1 off menu cocktails'", () => {
  const w = win(parseHappyHours("Happy hour Mon-Fri 3-6pm: $1 off menu cocktails", URL));
  assert.ok(w.offerings.length >= 1);
  assert.equal(w.offerings[0].kind, "drink");
  assert.equal(w.offerings[0].discountCents, 100);
});
check("two windows on one page both parse", () => {
  const ws = clean(parseHappyHours("Happy Hour 3-6pm and 9pm-close, Mon-Fri", URL));
  assert.equal(ws.length, 2);
});
check("sourceUrl + evidence carried", () => {
  const w = win(parseHappyHours("Happy Hour: 3pm-7pm daily", URL));
  assert.equal(w.sourceUrl, URL);
  assert.match(w.evidence, /3pm-7pm/);
});

// --- NEGATIVES (must NOT produce a clean window → escalate) ---
check("HH wording but NO time → 0 clean", () => {
  assert.equal(clean(parseHappyHours("We have the best happy hour in town!", URL)).length, 0);
});
check("'happy hour all day Monday' (no time bound) → 0 clean", () => {
  assert.equal(clean(parseHappyHours("Happy hour all day Monday", URL)).length, 0);
});
check("bare '3-7' with NO happy-hour/deal context → 0 clean", () => {
  assert.equal(clean(parseHappyHours("Open 3-7 for lunch service", URL)).length, 0);
});
check("empty text → []", () => {
  assert.deepEqual(parseHappyHours("", URL), []);
});

// --- adjacency / context-and-day bleed (CRITICAL) ---
check("brunch next to happy hour is NOT mislabeled as clean HH", () => {
  const ws = clean(parseHappyHours("Brunch Sat-Sun 10am-2pm. Happy Hour 4-6pm Mon-Fri", URL));
  assert.equal(ws.length, 1);
  assert.deepEqual(ws[0].daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(ws[0].startTime, "16:00");
  assert.equal(ws[0].endTime, "18:00");
});
check("kitchen hours next to happy hour is NOT mislabeled", () => {
  const ws = clean(parseHappyHours("Kitchen hours: Mon-Sun 11-9. Happy hour daily 3-6pm", URL));
  assert.equal(ws.length, 1);
  assert.deepEqual(ws[0].daysOfWeek, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(ws[0].startTime, "15:00");
  assert.equal(ws[0].endTime, "18:00");
});
// --- word boundaries (CRITICAL) ---
check("day names embedded in prose do not inject phantom days", () => {
  assert.equal(parseDays("we monitor quality"), null);
  assert.equal(clean(parseHappyHours("We monitor quality every shift", URL)).length, 0);
});
// --- inverted inferred time (IMPORTANT) ---
check("ambiguous no-meridiem range that inverts under pm-inference → not clean", () => {
  assert.equal(clean(parseHappyHours("Happy hour 11-2", URL)).length, 0);
});
// --- distinct per-day windows not merged (IMPORTANT) ---
check("separate Mon and Fri happy hours stay distinct", () => {
  const ws = clean(parseHappyHours("Happy hour Mon 3-6pm. Happy hour Fri 3-6pm", URL));
  assert.equal(ws.length, 2);
  const dayss = ws.map((w) => w.daysOfWeek).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(dayss, [[1], [5]]);
});

// --- meridiem abbreviations with periods (p.m. / a.m.) ---
check("spaced meridiem abbreviations 'p.m.' parse (not split apart)", () => {
  const w = win(parseHappyHours("Happy hour 3 p.m. - 6 p.m. Mon-Fri", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "18:00");
});
check("'11 a.m. - 2 p.m. daily' parses to clean window", () => {
  const w = win(parseHappyHours("Happy hour 11 a.m. - 2 p.m. daily", URL));
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(w.startTime, "11:00");
  assert.equal(w.endTime, "14:00");
});

// --- plausibility flag ---
check("normal afternoon HH is plausible", () => {
  assert.equal(win(parseHappyHours("Happy Hour: 3pm-7pm daily", URL)).plausible, true);
});
check("late-night HH to close stays plausible (no time-of-day penalty)", () => {
  assert.equal(win(parseHappyHours("Happy hour 9pm-close daily", URL)).plausible, true);
});
check("cross-midnight 11pm-2am stays plausible", () => {
  assert.equal(win(parseHappyHours("Happy Hour 11pm-2am Sunday through Thursday", URL)).plausible, true);
});
check("business-hours-shaped window (>6h) is implausible", () => {
  const ws = clean(parseHappyHours("Happy hour 11am-10pm daily", URL));
  assert.equal(ws.length, 1);
  assert.equal(ws[0].plausible, false);
});
check("weak evidence (deal word only + assumed days) is implausible", () => {
  assert.equal(win(parseHappyHours("Specials 4-6pm", URL)).plausible, false);
});
check("explicit happy hour + stated days + normal window is plausible", () => {
  assert.equal(win(parseHappyHours("Happy hour Mon-Fri 4pm-6pm", URL)).plausible, true);
});

// --- price / quantity / year ranges must NOT be parsed as times (CRITICAL real-data bug) ---
check("price range '$14-$38' is not a time window", () => {
  assert.equal(clean(parseHappyHours("Happy hour wings $14-$38", URL)).length, 0);
});
check("ascending price range '$5-$8' is not a time window", () => {
  assert.equal(clean(parseHappyHours("Happy hour draft beers $5-$8", URL)).length, 0);
});
check("quantity/cents range '80-99' is not a time", () => {
  assert.equal(clean(parseHappyHours("Happy hour oysters 80-99 each", URL)).length, 0);
});
check("year range '2019-2024' is not a time", () => {
  assert.equal(clean(parseHappyHours("Voted best happy hour 2019-2024", URL)).length, 0);
});
check("invalid hour '14-38' rejected", () => {
  assert.equal(clean(parseHappyHours("Happy hour 14-38", URL)).length, 0);
});
check("minute overflow '3:75-6:90' rejected", () => {
  assert.equal(clean(parseHappyHours("Happy hour 3:75pm-6:90pm", URL)).length, 0);
});
check("decimal '$3.5 wells' not parsed as 3:5 time", () => {
  assert.equal(clean(parseHappyHours("Happy hour $3.5 wells and $6 wine", URL)).length, 0);
});

// --- new signal: bare-number range w/o meridiem or 'happy hour' is implausible ---
check("bare-number range, deal word only, no meridiem → implausible (likely operating hours)", () => {
  const w = win(parseHappyHours("Daily specials 13-17", URL));
  assert.equal(w.confidence, "clean"); // still parses
  assert.equal(w.plausible, false);    // but low-confidence → hidden for review
});
check("explicit 'happy hour' with bare numbers stays plausible", () => {
  assert.equal(win(parseHappyHours("Happy hour 3-7", URL)).plausible, true);
});
check("deal word + explicit pm but NO 'happy hour' literal → implausible (review, not live)", () => {
  // Validated against real pages: a deal word ('specials'/'daily') next to a time is most
  // often menu/operating hours, not a happy hour. Live requires the literal phrase.
  const w = win(parseHappyHours("Specials daily 4pm-6pm", URL));
  assert.equal(w.confidence, "clean"); // still parses + captured
  assert.equal(w.plausible, false); // but hidden for review, not auto-shown
});
check("'happy hour' literal in the segment → plausible (live)", () => {
  assert.equal(win(parseHappyHours("Happy hour specials daily 4pm-6pm", URL)).plausible, true);
});

// --- quantity-noun ranges must NOT be parsed as times (The Switch SLO, 2026-06-12) ---
check("'4-6 course meals' is a count, not a 4-6pm window", () => {
  const ws = parseHappyHours(
    "We have featured events and special 4-6 course meals paired with beer or wine tastings. Happy hour specials at the bar.",
    URL,
  );
  assert.equal(ws.length, 0);
});
check("'2-4 people' / '3-5 items' are counts, not times", () => {
  assert.equal(parseHappyHours("Happy hour packages for 2-4 people", URL).length, 0);
  assert.equal(parseHappyHours("Daily specials: choose 3-5 items", URL).length, 0);
});
check("'4-6 oz pours' is a quantity, not a time", () => {
  assert.equal(parseHappyHours("Happy hour flights with 4-6 oz pours", URL).length, 0);
});
check("explicit meridiem wins over a trailing noun ('4-6pm course tastings')", () => {
  const w = win(parseHappyHours("Happy hour 4-6pm course tastings", URL));
  assert.equal(w.startTime, "16:00");
  assert.equal(w.endTime, "18:00");
});

// --- per-range day binding (Charlie's Place SLO, 2026-06-12) ---
check("two day:time pairs in one segment bind nearest-preceding days", () => {
  const ws = clean(parseHappyHours("HAPPY HOUR MON - FRI: 4:00 - 9:00PM SAT - SUN: 6:00 - 9:00PM", URL));
  assert.equal(ws.length, 2);
  assert.deepEqual(ws[0].daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(ws[0].startTime, "16:00");
  assert.equal(ws[0].endTime, "21:00");
  assert.deepEqual(ws[1].daysOfWeek, [6, 7]);
  assert.equal(ws[1].startTime, "18:00");
  assert.equal(ws[1].endTime, "21:00");
});
check("single trailing day spec still shared across ranges ('3-6pm and 9pm-close, Mon-Fri')", () => {
  const ws = clean(parseHappyHours("Happy hour 3-6pm and 9pm-close, Mon-Fri", URL));
  assert.equal(ws.length, 2);
  assert.deepEqual(ws[0].daysOfWeek, [1, 2, 3, 4, 5]);
  assert.deepEqual(ws[1].daysOfWeek, [1, 2, 3, 4, 5]);
});
check("day list with connectors binds as one expression ('Mon, Wed & Fri 3-6pm')", () => {
  const w = win(parseHappyHours("Happy hour Mon, Wed & Fri 3-6pm", URL));
  assert.deepEqual(w.daysOfWeek, [1, 3, 5]);
});
check("keyword day expr binds nearest-preceding ('Weekdays 3-6pm, weekends 5-7pm')", () => {
  const ws = clean(parseHappyHours("Happy hour weekdays 3-6pm, weekends 5-7pm", URL));
  assert.equal(ws.length, 2);
  assert.deepEqual(ws[0].daysOfWeek, [1, 2, 3, 4, 5]);
  assert.deepEqual(ws[1].daysOfWeek, [6, 7]);
});

// --- offerings: per-item categorization + price ranges (1865 HH menu, 2026-06-12) ---
check("deal list categorizes per item, not by whole-segment ('drafts' must not make wine a beer)", () => {
  const os = parseOfferings("$10 cocktails $8 wines $5 select drafts apps from $10-12", URL);
  const byName = Object.fromEntries(os.map((o) => [o.name, o]));
  const find = (frag: string) => os.find((o) => o.name.includes(frag));
  assert.equal(find("cocktails")?.category, "cocktail");
  assert.equal(find("cocktails")?.priceCents, 1000);
  assert.equal(find("wines")?.category, "wine");
  assert.equal(find("wines")?.priceCents, 800);
  assert.equal(find("drafts")?.category, "beer");
  assert.equal(find("drafts")?.priceCents, 500);
  assert.ok(byName, JSON.stringify(os));
});
check("'apps from $10-12' is a food offering at the range minimum, no orphan '$10'", () => {
  const os = parseOfferings("$10 cocktails $8 wines $5 select drafts apps from $10-12", URL);
  const apps = os.find((o) => o.name.includes("apps"));
  assert.ok(apps, JSON.stringify(os));
  assert.equal(apps!.kind, "food");
  assert.equal(apps!.priceCents, 1000);
  // No offering is a bare price with no item name.
  assert.ok(os.every((o) => /[a-z]/i.test(o.name.replace(/\$[\d.-]+/g, "").trim())), JSON.stringify(os));
  // 'drafts' label must not swallow the apps clause.
  const drafts = os.find((o) => o.name.includes("drafts"));
  assert.ok(!drafts!.name.includes("apps"), drafts!.name);
});
check("price-range-first '$10-12 apps' parses as one food offering at the minimum", () => {
  const os = parseOfferings("$10-12 apps during happy hour", URL);
  const apps = os.find((o) => o.name.includes("apps"));
  assert.ok(apps, JSON.stringify(os));
  assert.equal(apps!.kind, "food");
  assert.equal(apps!.priceCents, 1000);
});
check("existing forms still parse: '$1 off menu cocktails' and 'half-price wings'", () => {
  const off = parseOfferings("$1 off menu cocktails", URL);
  assert.equal(off[0].discountCents, 100);
  assert.equal(off[0].category, "cocktail");
  const half = parseOfferings("half-price wings", URL);
  assert.equal(half[0].kind, "food");
});

console.log(`\n${passed} checks passed.`);
