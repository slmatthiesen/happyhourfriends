# Free HTML-only stub fill + paid escalation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministically structure happy-hour text from a venue's own HTML for $0, auto-fill the clean cases, and escalate only ambiguous high-signal pages to the paid extractor — across both a stub-sweep script and new discovery.

**Architecture:** One pure parser (`lib/places/parseHhText.ts`) → an adapter (`lib/ai/freeExtract.ts`) that shapes clean windows into a cost-0 `ExtractResult` → consumed by (a) `extractHappyHours` as a free-first fast-path (covers on-demand enrich / `--quick` / admin), (b) the two batch builders (enrich + reextract), and (c) a new `reextract:stubs:free` sweep script. Clean parses persist through the existing audited `persistExtractedWindows` path; fuzzy/high-signal pages land on an escalation shortlist.

**Tech Stack:** TypeScript (strict), tsx scripts, postgres.js, Drizzle, Node `fetch`. No test framework — tests are runnable `tsx` assert scripts (repo convention).

---

## File Structure

- **Create** `lib/places/parseHhText.ts` — pure deterministic parser. `parseHappyHours(text, sourceUrl) → ParsedWindow[]`.
- **Create** `lib/ai/freeExtract.ts` — `freeExtractFromPages(pages, {model, promptHash}) → ExtractResult | null`. Bridges parser output to the persist layer's `ExtractResult`.
- **Create** `scripts/test-parse-hh-text.ts` — parser unit suite (positives + negatives).
- **Create** `scripts/test-free-extract.ts` — adapter unit suite.
- **Create** `scripts/reextract-stubs-free.ts` — the `$0` stub sweep + escalation shortlist writer.
- **Modify** `lib/ai/extractHappyHours.ts` — `ExtractRequest` gains `pages`; `ExtractInput` gains `noRender`; `buildExtractRequest` returns `pages` and honours `noRender`; `extractHappyHours` runs the free fast-path before the model call.
- **Modify** `scripts/seed-enrich-candidates.ts` — batch path: free fast-path between the `hasSignal` gate and the batch push.
- **Modify** `package.json` — add `reextract:stubs:free` script.

Conventions to match: `scripts/reextract-stubs.ts` (stub query, triage loop, `persistResult` wrapper, `--dry-run` default, browser close in `finally`); `scripts/test-site-triage.ts` (assert-script shape).

---

## Task 1: Pure parser `lib/places/parseHhText.ts`

**Files:**
- Create: `lib/places/parseHhText.ts`
- Test: `scripts/test-parse-hh-text.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-parse-hh-text.ts`:

```ts
/**
 * Runnable unit checks for parseHappyHours (no test framework in repo).
 * Run: pnpm tsx scripts/test-parse-hh-text.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { parseHappyHours, type ParsedWindow } from "@/lib/places/parseHhText";

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

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm tsx scripts/test-parse-hh-text.ts`
Expected: FAIL — `Cannot find module '@/lib/places/parseHhText'`.

- [ ] **Step 3: Implement `lib/places/parseHhText.ts`**

```ts
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
    if (a && b) return expandDayRange(a, b);
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
  const norm = text.replace(/ /g, " ").replace(/\s+/g, " ");
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm tsx scripts/test-parse-hh-text.ts`
Expected: PASS — `N checks passed.` (If a case fails, adjust the implementation, not the asserted value — the asserts encode the intended contract.)

- [ ] **Step 5: Commit**

```bash
git add lib/places/parseHhText.ts scripts/test-parse-hh-text.ts
git commit -m "feat(parse): deterministic happy-hour text parser ($0, clean/fuzzy)"
```

---

## Task 2: Adapter `lib/ai/freeExtract.ts`

**Files:**
- Create: `lib/ai/freeExtract.ts`
- Test: `scripts/test-free-extract.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-free-extract.ts`:

```ts
/**
 * Runnable unit checks for freeExtractFromPages.
 * Run: pnpm tsx scripts/test-free-extract.ts
 */
import assert from "node:assert/strict";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
const META = { model: "deterministic-html-v1", promptHash: "abc" };

check("clean window across pages → cost-0 ExtractResult", () => {
  const r = freeExtractFromPages(
    [{ url: "https://x.com/hh", text: "Happy Hour: 3pm-7pm daily" }],
    META,
  );
  assert.ok(r, "expected a result");
  assert.equal(r!.costCents, 0);
  assert.equal(r!.usage.inputTokens, 0);
  assert.equal(r!.model, "deterministic-html-v1");
  assert.equal(r!.happyHours.length, 1);
  assert.equal(r!.happyHours[0].startTime, "15:00");
  assert.equal(r!.confidence, 1);
});
check("only fuzzy content → null (escalate)", () => {
  const r = freeExtractFromPages(
    [{ url: "https://x.com", text: "We have the best happy hour in town!" }],
    META,
  );
  assert.equal(r, null);
});
check("no pages → null", () => {
  assert.equal(freeExtractFromPages([], META), null);
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm tsx scripts/test-free-extract.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/freeExtract'`.

- [ ] **Step 3: Implement `lib/ai/freeExtract.ts`**

```ts
/**
 * freeExtract — bridge the deterministic parser (lib/places/parseHhText) to the
 * persist layer's ExtractResult, so a $0 HTML parse flows through the exact same
 * audited write path as the paid extractor (lib/recover/resolveVenue).
 *
 * Returns null when no CLEAN window is found — the caller then escalates to the
 * paid extractor (or, in the sweep script, to the escalation shortlist).
 */
import type { FetchedPage } from "@/lib/ai/siteContent";
import type { ExtractResult, ExtractedHappyHour } from "@/lib/ai/extractHappyHours";
import { parseHappyHours } from "@/lib/places/parseHhText";

export function freeExtractFromPages(
  pages: FetchedPage[],
  meta: { model: string; promptHash: string },
): ExtractResult | null {
  const happyHours: ExtractedHappyHour[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    for (const w of parseHappyHours(p.text, p.url)) {
      if (w.confidence !== "clean") continue;
      const key = `${w.daysOfWeek.join(",")}|${w.startTime}|${w.endTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      happyHours.push({
        daysOfWeek: w.daysOfWeek,
        allDay: w.allDay,
        startTime: w.startTime,
        endTime: w.endTime,
        timeKnown: w.timeKnown,
        locationWithinVenue: w.locationWithinVenue,
        notes: w.notes,
        sourceUrl: w.sourceUrl,
        offerings: w.offerings.map((o) => ({
          kind: o.kind,
          category: o.category,
          name: o.name,
          priceCents: o.priceCents,
          originalPriceCents: null,
          discountCents: o.discountCents,
          description: null,
          conditions: null,
          sourceUrl: o.sourceUrl,
        })),
      });
    }
  }
  if (happyHours.length === 0) return null;
  return {
    happyHours,
    confidence: 1,
    summary: `Deterministic HTML parse: ${happyHours.length} window(s).`,
    venueType: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    costCents: 0,
    promptHash: meta.promptHash,
    model: meta.model,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm tsx scripts/test-free-extract.ts`
Expected: PASS — `3 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/ai/freeExtract.ts scripts/test-free-extract.ts
git commit -m "feat(extract): freeExtractFromPages adapter (parser → cost-0 ExtractResult)"
```

---

## Task 3: `buildExtractRequest` returns `pages` + honours `noRender`

**Files:**
- Modify: `lib/ai/extractHappyHours.ts`

- [ ] **Step 1: Add `pages` to `ExtractRequest`** — find the `ExtractRequest` interface (ends ~line 398) and add the field after `hasSignal`:

```ts
  hasSignal: boolean;
  /** The pages we fetched (text only). Lets callers run the free deterministic parser
   *  without re-fetching. PDFs/images aren't included (no text). */
  pages: FetchedPage[];
```

Ensure `FetchedPage` is imported. Find the existing `siteContent` import line:

```ts
import { fetchPages, renderPagesAsBlocks, pagesHaveExtractableSignal } from "@/lib/ai/siteContent";
```

and change it to also import the type:

```ts
import { fetchPages, renderPagesAsBlocks, pagesHaveExtractableSignal, type FetchedPage } from "@/lib/ai/siteContent";
```

- [ ] **Step 2: Add `noRender` to `ExtractInput`** — find the `ExtractInput` interface (has `websiteUrl?`, `otherUrl?`, `priorityUrls?`) and add:

```ts
  /** Skip the headless-render fallback (free batch sweep wants pure HTTP, no browser). */
  noRender?: boolean;
```

- [ ] **Step 3: Honour `noRender` and return `pages`** in `buildExtractRequest`. Change the render gate:

```ts
  let render: typeof import("@/lib/verification/renderUrl").renderUrl | undefined;
  if (!input.noRender && process.env.DISABLE_HEADLESS_RENDER !== "1") {
```

Then in the returned object (the `return { params: {...}, promptHash, model, fetchedUrls: pages.map((p) => p.url), hasSignal: ... }`), add `pages`:

```ts
    fetchedUrls: pages.map((p) => p.url),
    hasSignal: pagesHaveExtractableSignal(pages),
    pages,
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS (no output). `extractHappyHours` already destructures from `buildExtractRequest`; adding a field is backward-compatible.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/extractHappyHours.ts
git commit -m "feat(extract): buildExtractRequest returns fetched pages + noRender option"
```

---

## Task 4: `extractHappyHours` free-first fast-path

**Files:**
- Modify: `lib/ai/extractHappyHours.ts`

This covers every synchronous caller at once: on-demand enrich (`seed-enrich-candidates.ts:569`), `reextract-stubs.ts --quick`, and the admin Stub Resolver.

- [ ] **Step 1: Import the adapter** — add near the top imports of `lib/ai/extractHappyHours.ts`:

```ts
import { freeExtractFromPages } from "@/lib/ai/freeExtract";
```

- [ ] **Step 2: Insert the free fast-path** in `extractHappyHours`, right AFTER the `if (!hasSignal) { ... }` block and BEFORE `const response: Message = await anthropic().messages.create(params);`. First update the destructure at the top of the function to capture `pages`:

```ts
  const { params, promptHash, model, fetchedUrls, hasSignal, pages } = await buildExtractRequest(input);
```

Then add:

```ts
  // Free deterministic parse: if the fetched HTML yields ≥1 CLEAN happy-hour window,
  // take it for $0 and skip the paid model call entirely.
  const free = freeExtractFromPages(pages, { model: "deterministic-html-v1", promptHash });
  if (free) {
    if (process.env.EXTRACT_DEBUG) console.error(`[extract] free parse hit: ${free.happyHours.length} window(s), $0`);
    return free;
  }
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Integration smoke (free, no DB writes)** — confirm the fast-path fires end-to-end on Philly's:

Run: `pnpm tsx scripts/debug-extract.ts --url "https://phillyssportsgrill.com/index.php/scottsdale/" --name "Philly's Sports Grill" --type sports_bar 2>&1 | grep -iE "free parse hit|in=|VERDICT|15:00" | head`

Wait — `debug-extract.ts` calls `anthropic().messages.create` directly (not `extractHappyHours`), so it will NOT show the fast-path. Instead verify via a tiny inline harness:

```bash
cd /Users/stevenmatthiesen/Personal/happyhourfriends
cat > scripts/_free-smoke.ts <<'EOF'
import "dotenv/config";
import { extractHappyHours } from "@/lib/ai/extractHappyHours";
(async () => {
  const r = await extractHappyHours({ venueName: "Philly's Sports Grill",
    websiteUrl: "https://phillyssportsgrill.com/index.php/scottsdale/", otherUrl: null,
    cityName: "Scottsdale", priorityUrls: [] });
  console.log("model:", r.model, "cost¢:", r.costCents, "windows:", r.happyHours.length);
  console.log(r.happyHours.map(h => ({ d: h.daysOfWeek, s: h.startTime, e: h.endTime })));
  await (await import("@/lib/verification/renderUrl")).closeRenderBrowser().catch(() => {});
})();
EOF
pnpm tsx scripts/_free-smoke.ts; rm -f scripts/_free-smoke.ts
```

Expected: `model: deterministic-html-v1 cost¢: 0 windows: 1` (or 2), with a `15:00–19:00` window — proving $0 recovery with no model call.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/extractHappyHours.ts
git commit -m "feat(extract): free deterministic parse before the paid model call"
```

---

## Task 5: `reextract:stubs:free` sweep script

**Files:**
- Create: `scripts/reextract-stubs-free.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `scripts/reextract-stubs-free.ts`**

```ts
/**
 * reextract:stubs:free — $0 stub recovery. NO Anthropic API. For every stub with a
 * website: triage (sitemap-aware) → fetch pages (plain HTTP, no browser) → deterministic
 * parse. CLEAN windows are written through the shared audited persist path; pages with a
 * happy-hour signal but no clean parse are written to an escalation shortlist for the paid
 * extractor (reextract:stubs --venue / the /admin/stubs Auto-retry button).
 *
 * Dry-run by DEFAULT. Pass --apply to write.
 * Usage: pnpm tsx scripts/reextract-stubs-free.ts --city <slug> [--limit N] [--apply]
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";
import { persistExtractedWindows } from "@/lib/recover/resolveVenue";
import { hasHhOrDealSignal } from "@/lib/places/hhText";

function arg(f: string) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; }
const CITY = arg("--city");
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const APPLY = process.argv.includes("--apply");

interface StubVenue { id: string; name: string; website_url: string | null; primary_type: string | null; }

async function main() {
  if (!CITY) throw new Error("--city <slug> required");
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const [city] = await sql<{ id: string; name: string; slug: string }[]>`
      SELECT id, name, slug FROM cities WHERE slug = ${CITY}`;
    if (!city) throw new Error(`city '${CITY}' not found`);

    const stubs = await sql<StubVenue[]>`
      SELECT v.id, v.name, v.website_url, sc.primary_type
      FROM venues v
      LEFT JOIN seed_candidates sc ON sc.resulting_venue_id = v.id
      WHERE v.city_id = ${city.id} AND v.status = 'active'
        AND v.data_completeness = 'stub' AND v.website_url IS NOT NULL
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(`[${APPLY ? "APPLY" : "DRY RUN"}] ${stubs.length} stub(s) with a website in ${city.name}. $0 — no API.\n`);

    let filled = 0, escalated = 0, noSignal = 0, social = 0;
    const shortlist: { venueId: string; name: string; citySlug: string; url: string; snippet: string }[] = [];

    for (const v of stubs) {
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const likelihood = hhLikelihood({ primaryType: v.primary_type, types: null, name: v.name });
      const decided = resolveEnrichAction(verdict, likelihood);
      if (decided.action !== "extract") { social++; continue; }

      const built = await buildExtractRequest({
        venueName: v.name,
        websiteUrl: verdict.kind === "real" ? verdict.url : null,
        otherUrl: null, cityName: city.name,
        priorityUrls: decided.priorityUrls, noRender: true,
      });

      const free = freeExtractFromPages(built.pages, { model: "deterministic-html-v1", promptHash: built.promptHash });
      if (free) {
        const days = free.happyHours.map((h) => `${h.daysOfWeek.length}d ${h.startTime ?? "open"}-${h.endTime ?? "close"}`).join(", ");
        if (APPLY) {
          const { windowsLive, windowsHidden } = await persistExtractedWindows({ venueId: v.id, cityId: city.id, extracted: free, actor: "reextract-free" });
          console.log(`  ✓ ${v.name}: +${windowsLive} live${windowsHidden ? ` (+${windowsHidden} hidden)` : ""} [${days}]`);
        } else {
          console.log(`  ✓ ${v.name}: WOULD write [${days}]`);
        }
        filled++;
        continue;
      }

      // No clean parse — does the page even show a signal? If so, escalate to paid.
      const signalPage = built.pages.find((p) => hasHhOrDealSignal(p.text));
      if (signalPage) {
        const snippet = (signalPage.text.match(/.{0,40}happy[ -]?hour.{0,80}/i)?.[0] ?? signalPage.text.slice(0, 120)).replace(/\s+/g, " ").trim();
        shortlist.push({ venueId: v.id, name: v.name, citySlug: city.slug, url: signalPage.url, snippet });
        console.log(`  ⚑ ${v.name}: signal but no clean parse → escalate`);
        escalated++;
      } else {
        noSignal++;
      }
    }

    if (shortlist.length > 0) {
      const outFile = `docs/hh-escalation-${city.slug}.json`;
      writeFileSync(outFile, JSON.stringify(shortlist, null, 2));
      console.log(`\nEscalation shortlist (${shortlist.length}) → ${outFile}`);
      console.log("Run the paid extractor on these, e.g.:");
      for (const s of shortlist.slice(0, 10)) console.log(`  pnpm tsx scripts/reextract-stubs.ts --venue ${s.venueId} --url ${s.url}`);
      if (shortlist.length > 10) console.log(`  …and ${shortlist.length - 10} more in ${outFile}`);
    }

    console.log(`\n── Free fill complete ──`);
    console.log(`  filled (clean, $0):   ${filled}${APPLY ? "" : "  (dry-run — re-run with --apply to write)"}`);
    console.log(`  escalated (→ paid):   ${escalated}`);
    console.log(`  no signal (stub):     ${noSignal}`);
    console.log(`  social/non-extract:   ${social}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script** — in `package.json`, in `"scripts"`, next to the existing `"reextract:stubs"` entry, add:

```json
    "reextract:stubs:free": "tsx scripts/reextract-stubs-free.ts",
```

(Find the line `"reextract:stubs": "tsx scripts/reextract-stubs.ts",` and add the new line right after it. Keep valid JSON — comma placement.)

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Free dry-run on a real city (no API, no writes)**

Run: `pnpm tsx scripts/reextract-stubs-free.ts --city scottsdale --limit 30`
Expected: a mix of `✓ … WOULD write`, `⚑ … escalate`, and the summary line. No spend, no DB writes. Confirm Philly's (if present as a stub) shows `WOULD write`.

- [ ] **Step 5: Commit**

```bash
git add scripts/reextract-stubs-free.ts package.json
git commit -m "feat(scripts): reextract:stubs:free — \$0 stub fill + escalation shortlist"
```

---

## Task 6: enrich batch free fast-path

**Files:**
- Modify: `scripts/seed-enrich-candidates.ts`

The on-demand enrich path (line ~569) is already covered by Task 4 (it calls `extractHappyHours`). This task covers the **batch** path, which calls `buildExtractRequest` directly and submits to the Batch API.

- [ ] **Step 1: Import the adapter + persist helper** — at the top of `scripts/seed-enrich-candidates.ts`, add to the imports:

```ts
import { freeExtractFromPages } from "@/lib/ai/freeExtract";
```

Confirm `persistExtraction` (the script's existing wrapper) is already imported and used near line 1015 — it is.

- [ ] **Step 2: Insert the free fast-path** in the batch builder loop. Find the `hasSignal` gate (~line 1051) that ends with `continue;` after `tally.noData.push({ ... reason: "no_hh_signal" })`. Immediately AFTER that block (before `requests.push({ custom_id: c.id, params: built.params });`), insert:

```ts
    // Free deterministic parse — if the HTML yields ≥1 CLEAN window, persist it for $0
    // and DON'T add this candidate to the paid batch.
    const free = freeExtractFromPages(built.pages, { model: "deterministic-html-v1", promptHash: built.promptHash });
    if (free) {
      const persisted = await persistExtraction(sql, { cityId: city.id, placesKey, ctx, extracted: free });
      await markProcessed(sql, c.id, persisted.outcome, persisted.venueId);
      tally.full++;
      console.log(`  ✓ ${c.name}: free parse → ${free.happyHours.length} window(s) ($0)`);
      continue;
    }
```

Note: `ctx`, `placesKey`, `city`, `tally`, `markProcessed`, `persistExtraction` are all already in scope at this point in the loop (the `hasSignal` block above uses them identically). Match the exact field names used by the adjacent `persistExtraction` call.

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Confirm wiring by reading the diff**

Run: `git diff scripts/seed-enrich-candidates.ts`
Expected: the free block sits between the `no_hh_signal` `continue` and `requests.push(...)`, using the same `persistExtraction`/`markProcessed` calls as the surrounding code.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-enrich-candidates.ts
git commit -m "feat(enrich): free deterministic parse before paid batch (skip API on clean HH)"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: All unit suites pass**

Run:
```bash
pnpm tsx scripts/test-parse-hh-text.ts && pnpm tsx scripts/test-free-extract.ts && pnpm tsx scripts/test-site-triage.ts && pnpm tsx scripts/test-fetchurl-harvest.ts
```
Expected: every script prints `N checks passed.` and exits 0.

- [ ] **Step 2: Typecheck + lint changed files**

Run:
```bash
pnpm run typecheck && pnpm exec eslint lib/places/parseHhText.ts lib/ai/freeExtract.ts lib/ai/extractHappyHours.ts scripts/reextract-stubs-free.ts scripts/seed-enrich-candidates.ts scripts/test-parse-hh-text.ts scripts/test-free-extract.ts
```
Expected: typecheck clean; eslint no errors on changed files.

- [ ] **Step 3: Build gate**

Run: `rm -rf .next && pnpm run build`
Expected: compiles, exit 0.

- [ ] **Step 4: Free dry-run sanity on a second city**

Run: `pnpm tsx scripts/reextract-stubs-free.ts --city tucson --limit 40`
Expected: a sensible filled/escalated/no-signal split, $0, no writes.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/free-html-stub-fill
gh pr create --title "feat: free HTML-only stub fill + paid escalation" --body "Deterministic \$0 happy-hour parser; auto-fills clean stubs, escalates fuzzy/high-signal pages to the paid extractor; free-first fast-path wired into seed:enrich. Spec: docs/superpowers/specs/2026-06-06-free-html-stub-fill-design.md"
```

---

## Self-review notes

- **Spec coverage:** parser (Task 1) ✓ · times+attached offerings (Task 1: `parseOfferings`) ✓ · confidence-tiered auto-apply (Task 5 `--apply` + `clean`-only persist) ✓ · escalation shortlist = Tier-2 list (Task 5) ✓ · discovery integration (Tasks 4 on-demand + 6 batch) ✓ · render off in free pass (Task 3 `noRender`, Task 5 passes it) ✓ · dry-run default (Task 5) ✓ · audited write via `persistExtractedWindows`/`persistExtraction` ✓ · negative tests (Task 1) ✓.
- **Type consistency:** `freeExtractFromPages(pages, {model, promptHash})` signature identical across Tasks 2/4/5/6; `ParsedWindow`/`ParsedOffering` (Task 1) consumed only in Task 2; `ExtractedHappyHour`/`ExtractedOffering` field names match `lib/ai/extractHappyHours.ts` (`originalPriceCents`, `description`, `conditions` set to null). `model: "deterministic-html-v1"` used consistently.
- **No placeholders:** every code step is complete.
