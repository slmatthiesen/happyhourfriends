# Venue Type Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `venues.type` for every venue (no more "—"), via a deterministic Google-type map + name-keyword fallback, refined by AI, with friendly display labels and a moderated user-edit path.

**Architecture:** One shared pure module `lib/places/venueType.ts` (map + keyword rules + labels + enum guard) is the single source of truth. A backfill script writes existing venues (Phase 1 deterministic, Phase 2 cheap AI refine). The enrich pipeline writes type at insert (deterministic base, optionally overridden by a confident extractor `venueType`). Display swaps `_`-replacement for the label map. Users change a type through the existing "report a change" flow (interpreter learns `type`).

**Tech Stack:** TypeScript (strict), Drizzle ORM, postgres.js, `tsx` scripts, Anthropic SDK (Haiku), Node `node:assert` for tests (no test framework in repo — verification is `tsc`/`eslint`/`next build` + runnable assertion scripts).

---

## File Structure

- **Create** `lib/places/venueType.ts` — `VenueType`, `VENUE_TYPES`, `GOOGLE_TYPE_MAP`, `RESTAURANT_FALLBACK`, `NAME_KEYWORD_RULES`, `deriveVenueType()`, `isVenueType()`, `VENUE_TYPE_LABELS`, `labelForVenueType()`. Pure, no I/O.
- **Create** `scripts/test-venue-type.ts` — `node:assert` assertion runner for the pure module + interpreter validation helper.
- **Create** `scripts/backfill-venue-types.ts` — Phase 1 deterministic write + Phase 2 AI refine; `--city`, `--no-ai`, `--dry-run`, `--limit`.
- **Modify** `components/venue-table-client.tsx` — 5 display sites (chips, sort, 2 desktop cells, 2 mobile cards) → labels.
- **Modify** `app/[city]/venue/[slug]/page.tsx:167-171` — badge → label.
- **Modify** `lib/ai/interpreter.ts` — `update_venue` learns `type`; `venueStateJson` exposes it; `normaliseOp` validates the enum (exported for test).
- **Modify** `prompts/interpret-submission.md` — document the `type` field + valid values.
- **Modify** `lib/ai/extractHappyHours.ts` — `venueType` on the tool schema, `RawExtract`, `NormalisedExtract`, `ExtractResult`, parse paths.
- **Modify** `prompts/seed-extract-hh.md` — instruct optional `venueType` (evidence-only).
- **Modify** `lib/ai/enrichBatchState.ts` — `PrepContext` gains `primaryType`, `types`.
- **Modify** `scripts/seed-enrich-candidates.ts` — candidate SELECTs fetch `primary_type`/`types`; both `PrepContext` builds populate them; `insertVenueRow` writes `type`; `persistExtraction` fills type on the existing-venue path.
- **Modify** `package.json` — `test:venue-type`, `backfill:venue-types` scripts.

---

## Task 1: Shared `lib/places/venueType.ts` module (TDD)

**Files:**
- Create: `lib/places/venueType.ts`
- Create: `scripts/test-venue-type.ts`
- Modify: `package.json` (scripts block, around line 27)

- [ ] **Step 1: Write the failing test** — create `scripts/test-venue-type.ts`:

```ts
/**
 * Runnable unit checks for the venue-type derivation + labels (no test framework in
 * repo). Run: npx tsx scripts/test-venue-type.ts  — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  deriveVenueType,
  isVenueType,
  labelForVenueType,
  VENUE_TYPES,
  VENUE_TYPE_LABELS,
} from "@/lib/places/venueType";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- Google primaryType map ------------------------------------------------
check("primaryType bar -> bar", () =>
  assert.equal(deriveVenueType({ primaryType: "bar", types: null, name: "X" }), "bar"));
check("sports_bar -> sports_bar", () =>
  assert.equal(deriveVenueType({ primaryType: "sports_bar", types: null, name: "X" }), "sports_bar"));
check("cocktail_bar -> cocktail_lounge", () =>
  assert.equal(deriveVenueType({ primaryType: "cocktail_bar", types: null, name: "X" }), "cocktail_lounge"));
check("lounge_bar -> cocktail_lounge", () =>
  assert.equal(deriveVenueType({ primaryType: "lounge_bar", types: null, name: "X" }), "cocktail_lounge"));
check("night_club -> club", () =>
  assert.equal(deriveVenueType({ primaryType: "night_club", types: null, name: "X" }), "club"));
check("irish_pub -> pub", () =>
  assert.equal(deriveVenueType({ primaryType: "irish_pub", types: null, name: "X" }), "pub"));
check("brewery -> brewery", () =>
  assert.equal(deriveVenueType({ primaryType: "brewery", types: null, name: "X" }), "brewery"));
check("pizza_restaurant -> pizzeria", () =>
  assert.equal(deriveVenueType({ primaryType: "pizza_restaurant", types: null, name: "X" }), "pizzeria"));
check("gastropub -> gastropub", () =>
  assert.equal(deriveVenueType({ primaryType: "gastropub", types: null, name: "X" }), "gastropub"));
check("coffee_shop -> cafe", () =>
  assert.equal(deriveVenueType({ primaryType: "coffee_shop", types: null, name: "X" }), "cafe"));

// --- restaurant fallback (generic + *_restaurant tail) ---------------------
check("mexican_restaurant -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "mexican_restaurant", types: null, name: "X" }), "restaurant"));
check("bar_and_grill -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "bar_and_grill", types: null, name: "X" }), "restaurant"));
check("steak_house -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "steak_house", types: null, name: "X" }), "restaurant"));
check("fine_dining_restaurant -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "fine_dining_restaurant", types: null, name: "X" }), "restaurant"));

// --- types[] fallback when primaryType is null -----------------------------
check("types[] brewery wins when primaryType null", () =>
  assert.equal(
    deriveVenueType({ primaryType: null, types: ["point_of_interest", "brewery"], name: "X" }),
    "brewery",
  ));

// --- name keywords when no Google type -------------------------------------
check("name 'Harmon Brewing' -> brewery", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Harmon Brewing Co" }), "brewery"));
check("name 'The Swiss Pub' -> pub", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "The Swiss Pub" }), "pub"));
check("name 'Moctezuma's Tequila Bar' -> bar", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Moctezuma's Tequila Bar" }), "bar"));
check("name 'Sports Bar X' beats generic bar -> sports_bar", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Joe's Sports Bar" }), "sports_bar"));

// --- final default ---------------------------------------------------------
check("no signal -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Stanley & Seafort's" }), "restaurant"));

// --- enum guard ------------------------------------------------------------
check("isVenueType true for 'pub'", () => assert.equal(isVenueType("pub"), true));
check("isVenueType false for 'gastro_pub'", () => assert.equal(isVenueType("gastro_pub"), false));
check("isVenueType false for null", () => assert.equal(isVenueType(null), false));

// --- labels ----------------------------------------------------------------
check("labels exhaustive over enum", () => {
  for (const t of VENUE_TYPES) assert.ok(VENUE_TYPE_LABELS[t], `missing label for ${t}`);
});
check("dive_bar label is 'Dive'", () => assert.equal(VENUE_TYPE_LABELS.dive_bar, "Dive"));
check("cocktail_lounge label is 'Cocktails'", () => assert.equal(VENUE_TYPE_LABELS.cocktail_lounge, "Cocktails"));
check("hotel_bar label is 'Hotel'", () => assert.equal(VENUE_TYPE_LABELS.hotel_bar, "Hotel"));
check("other label is 'Venue'", () => assert.equal(VENUE_TYPE_LABELS.other, "Venue"));
check("labelForVenueType(null) is ''", () => assert.equal(labelForVenueType(null), ""));
check("labelForVenueType('pub') is 'Pub'", () => assert.equal(labelForVenueType("pub"), "Pub"));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Add the npm script** — in `package.json` scripts block (after the `export:candidates` line ~27), add:

```json
    "test:venue-type": "tsx scripts/test-venue-type.ts",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/test-venue-type.ts`
Expected: FAIL — `Cannot find module '@/lib/places/venueType'` (module not created yet).

- [ ] **Step 4: Implement the module** — create `lib/places/venueType.ts`:

```ts
/**
 * Venue type derivation + display labels. Single source of truth shared by the
 * backfill script (existing venues) and the enrich pipeline (new venues). Pure, no I/O.
 *
 * Stored values are the venue_type enum keys (machine values); the UI renders the
 * friendly labels in VENUE_TYPE_LABELS, never the raw key.
 */
import { venueType as venueTypeEnum } from "@/db/schema/enums";

export type VenueType = (typeof venueTypeEnum.enumValues)[number];
export const VENUE_TYPES = venueTypeEnum.enumValues;

const VENUE_TYPE_SET = new Set<string>(VENUE_TYPES);
export function isVenueType(x: unknown): x is VenueType {
  return typeof x === "string" && VENUE_TYPE_SET.has(x);
}

/** Explicit Google primaryType / types[] -> our enum, for the NON-restaurant cases. */
export const GOOGLE_TYPE_MAP: Record<string, VenueType> = {
  bar: "bar",
  sports_bar: "sports_bar",
  cocktail_bar: "cocktail_lounge",
  lounge_bar: "cocktail_lounge",
  wine_bar: "wine_bar",
  pub: "pub",
  irish_pub: "pub",
  brewery: "brewery",
  beer_garden: "bar",
  night_club: "club",
  gastropub: "gastropub",
  cafe: "cafe",
  coffee_shop: "coffee_shop" in {} ? "cafe" : "cafe", // coffee_shop -> cafe
  pizza_restaurant: "pizzeria",
  pizzeria: "pizzeria",
  live_music_venue: "bar",
  sports_complex: "other",
};

/** Google food types that should collapse to plain "restaurant". */
const RESTAURANT_FALLBACK = new Set<string>([
  "restaurant",
  "bar_and_grill",
  "steak_house",
  "fine_dining_restaurant",
  "brunch_restaurant",
  "buffet_restaurant",
  "diner",
  "food_court",
  "meal_takeaway",
  "meal_delivery",
  "fast_food_restaurant",
]);

/** True for any Google type that means "a place that serves food" -> restaurant. */
function isRestaurantType(t: string): boolean {
  return RESTAURANT_FALLBACK.has(t) || t.endsWith("_restaurant");
}

/** Ordered name-keyword rules, used ONLY when Google gives us no type. First match wins. */
export const NAME_KEYWORD_RULES: Array<{ re: RegExp; type: VenueType }> = [
  { re: /\bsports\s?bar\b/i, type: "sports_bar" },
  { re: /\bwine\s?bar\b/i, type: "wine_bar" },
  { re: /\b(brew(ery|ing)|brewhouse|brewpub)\b/i, type: "brewery" },
  { re: /\b(taproom|tap\s?house|tasting\s?room|cellars?|winery|vineyard)\b/i, type: "tasting_room" },
  { re: /\b(pub|alehouse|ale\s?house)\b/i, type: "pub" },
  { re: /\b(cantina|tequila|saloon)\b/i, type: "bar" },
  { re: /\b(night\s?club|nightclub)\b/i, type: "club" },
  { re: /\blounge\b/i, type: "cocktail_lounge" },
  { re: /\bpizz(a|eria)\b/i, type: "pizzeria" },
  { re: /\b(caf[eé]|coffee|espresso)\b/i, type: "cafe" },
  { re: /\b(bar|tavern)\b/i, type: "bar" },
];

function fromGoogleType(t: string | null | undefined): VenueType | null {
  if (!t) return null;
  if (GOOGLE_TYPE_MAP[t]) return GOOGLE_TYPE_MAP[t];
  if (isRestaurantType(t)) return "restaurant";
  return null;
}

/**
 * Resolve a venue type. Order: Google primaryType -> first matching types[] entry ->
 * name keywords -> "restaurant" default. Never returns null.
 */
export function deriveVenueType(input: {
  primaryType: string | null | undefined;
  types: string[] | null | undefined;
  name: string;
}): VenueType {
  const fromPrimary = fromGoogleType(input.primaryType);
  if (fromPrimary) return fromPrimary;

  for (const t of input.types ?? []) {
    const m = fromGoogleType(t);
    if (m) return m;
  }

  for (const rule of NAME_KEYWORD_RULES) {
    if (rule.re.test(input.name)) return rule.type;
  }

  return "restaurant";
}

/** Friendly, tight display labels. Exhaustive over the enum (compile-checked by Record). */
export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  restaurant: "Restaurant",
  bar: "Bar",
  sports_bar: "Sports Bar",
  pub: "Pub",
  dive_bar: "Dive",
  wine_bar: "Wine Bar",
  brewery: "Brewery",
  tasting_room: "Taproom",
  cocktail_lounge: "Cocktails",
  gastropub: "Gastropub",
  club: "Club",
  cafe: "Café",
  hotel_bar: "Hotel",
  pizzeria: "Pizzeria",
  other: "Venue",
};

/** Display label for a (possibly null) type. Null -> "" (render nothing, never a dash). */
export function labelForVenueType(type: VenueType | string | null | undefined): string {
  if (type && isVenueType(type)) return VENUE_TYPE_LABELS[type];
  return "";
}
```

> NOTE: in `GOOGLE_TYPE_MAP`, write the `coffee_shop` entry simply as `coffee_shop: "cafe",` — drop the placeholder ternary shown above (it was only to flag the mapping). Final line: `coffee_shop: "cafe",`.

- [ ] **Step 5: Fix the coffee_shop line** — ensure the map literally reads:

```ts
  cafe: "cafe",
  coffee_shop: "cafe",
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx scripts/test-venue-type.ts`
Expected: PASS — all checks print `✓`, ends with `N checks passed.`, exit 0.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npx eslint lib/places/venueType.ts scripts/test-venue-type.ts`
Expected: no new errors (the 2 pre-existing Phase 0 lint issues are unrelated).

- [ ] **Step 8: Commit**

```bash
git add lib/places/venueType.ts scripts/test-venue-type.ts package.json
git commit -m "feat(venue-type): shared derivation map + friendly labels + tests"
```

---

## Task 2: Friendly labels in the grid + venue page

**Files:**
- Modify: `components/venue-table-client.tsx` (lines ~163, ~336, ~579, ~725, ~778, ~850, ~903)
- Modify: `app/[city]/venue/[slug]/page.tsx:167-171`

- [ ] **Step 1: Import the label helper in the grid** — at the top of `components/venue-table-client.tsx`, add to the imports (near the existing `import type { HappyHourRow, VenueListItem }` line ~11):

```ts
import { labelForVenueType } from "@/lib/places/venueType";
```

- [ ] **Step 2: Type filter chips show labels** — replace line ~579 (`{t.replace(/_/g, " ")}`) with:

```tsx
                {labelForVenueType(t)}
```

- [ ] **Step 3: Sort by label** — replace the `case "type":` block (lines ~335-338) with:

```tsx
        case "type": {
          const t = labelForVenueType(a.type).localeCompare(labelForVenueType(b.type));
          return t !== 0 ? t : a.name.localeCompare(b.name);
        }
```

- [ ] **Step 4: Desktop full-venue Type cell** — replace lines ~724-726:

```tsx
                      <td className="px-4 py-3 text-text-muted">
                        {labelForVenueType(v.type) || "—"}
                      </td>
```

- [ ] **Step 5: Desktop stub Type cell** — replace lines ~777-779:

```tsx
                    <td className="px-4 py-3">
                      {labelForVenueType(v.type) || "—"}
                    </td>
```

- [ ] **Step 6: Mobile full-venue card meta line** — replace lines ~850-852:

```tsx
                    {[labelForVenueType(v.type) || null, showNeighborhood ? v.neighborhoodName : null]
                      .filter(Boolean)
                      .join(" · ")}
```

- [ ] **Step 7: Mobile stub card meta line** — replace the condition+body at lines ~901-906:

```tsx
                {(labelForVenueType(v.type) || (showNeighborhood && v.neighborhoodName)) && (
                  <p className="mt-0.5 text-xs">
                    {[labelForVenueType(v.type) || null, showNeighborhood ? v.neighborhoodName : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
```

- [ ] **Step 8: Venue page badge** — in `app/[city]/venue/[slug]/page.tsx`, add the import near the top (with the other `@/lib` imports):

```ts
import { labelForVenueType } from "@/lib/places/venueType";
```

Then replace lines ~167-171:

```tsx
        {labelForVenueType(venue.type) && (
          <span className="mt-3 inline-block rounded-full border border-border bg-bg-elevated px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-text-muted">
            {labelForVenueType(venue.type)}
          </span>
        )}
```

- [ ] **Step 9: Typecheck + lint + build**

Run: `npm run typecheck && npx eslint components/venue-table-client.tsx "app/[city]/venue/[slug]/page.tsx"`
Expected: clean (no new errors).

- [ ] **Step 10: Commit**

```bash
git add components/venue-table-client.tsx "app/[city]/venue/[slug]/page.tsx"
git commit -m "feat(venue-type): render friendly type labels in grid + venue page"
```

---

## Task 3: Moderated user type-edits via the interpreter (TDD)

**Files:**
- Modify: `lib/ai/interpreter.ts` (tool desc ~126, `venueStateJson` ~177, `normaliseOp` ~215)
- Modify: `prompts/interpret-submission.md`
- Modify: `scripts/test-venue-type.ts` (add interpreter validation checks)

- [ ] **Step 1: Add failing checks for `normaliseOp` enum validation** — append to `scripts/test-venue-type.ts` (before the final `console.log`):

```ts
// --- interpreter: update_venue type validation -----------------------------
import { normaliseOp } from "@/lib/ai/interpreter";

check("update_venue keeps a valid type", () => {
  const op = normaliseOp({
    action: "update_venue",
    after: { type: "pub" },
    summary: "make it a pub",
    confidence: 0.9,
  });
  assert.equal(op?.after.type, "pub");
});
check("update_venue strips an invalid type", () => {
  const op = normaliseOp({
    action: "update_venue",
    after: { type: "gastro_pub", phone: "555" },
    summary: "x",
    confidence: 0.9,
  });
  assert.ok(op, "op should survive");
  assert.equal("type" in op!.after, false, "invalid type stripped");
  assert.equal((op!.after as Record<string, unknown>).phone, "555", "other fields kept");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-venue-type.ts`
Expected: FAIL — `normaliseOp` is not exported (import error) / type not stripped.

- [ ] **Step 3: Export `normaliseOp` + import the guard** — in `lib/ai/interpreter.ts`, add near the top imports:

```ts
import { isVenueType, VENUE_TYPES } from "@/lib/places/venueType";
```

Change the declaration `function normaliseOp(raw: RawOp): InterpretedOp | null {` (line ~215) to:

```ts
export function normaliseOp(raw: RawOp): InterpretedOp | null {
```

- [ ] **Step 4: Validate the venue type inside `normaliseOp`** — replace the `return { ... }` block at the end of `normaliseOp` (lines ~222-229) with:

```ts
  const after = { ...(raw.after as Record<string, unknown>) };
  // Drop an invalid venue type rather than emit a value Postgres' enum will reject.
  if (action === "update_venue" && "type" in after && !isVenueType(after.type)) {
    delete after.type;
  }

  return {
    action,
    targetId: typeof raw.targetId === "string" ? raw.targetId : null,
    happyHourId: typeof raw.happyHourId === "string" ? raw.happyHourId : null,
    after,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
  };
```

- [ ] **Step 5: Teach the tool schema about `type`** — in the `update_venue` description (line ~126), replace:

```ts
                "update_venue (name/address/phone/websiteUrl/otherUrl/status), " +
```

with:

```ts
                "update_venue (name/address/phone/websiteUrl/otherUrl/status/type), " +
```

And extend the `after` description (lines ~144-148) by appending this sentence to the existing string:

```ts
                "venue type must be one of: " + VENUE_TYPES.join(", ") + ". " +
```

(Insert it inside the concatenated description string, e.g. right after the `venue status is one of …` sentence.)

- [ ] **Step 6: Expose current `type` in `venueStateJson`** — in `venueStateJson` (line ~178), add `type` to the returned object, right after `status: venue.status,`:

```ts
    type: venue.type,
```

- [ ] **Step 7: Document it in the prompt** — in `prompts/interpret-submission.md`, find the section listing what `update_venue` can change and add a bullet (match the file's existing list style):

```markdown
- **type** — the venue category. Only set it when the user clearly states the kind of
  place (e.g. "this is a dive bar", "it's actually a brewery"). Must be one of the
  allowed venue types; if unsure, do not set it.
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx tsx scripts/test-venue-type.ts`
Expected: PASS — all checks including the two new interpreter checks.

- [ ] **Step 9: Typecheck + lint**

Run: `npm run typecheck && npx eslint lib/ai/interpreter.ts scripts/test-venue-type.ts`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add lib/ai/interpreter.ts prompts/interpret-submission.md scripts/test-venue-type.ts
git commit -m "feat(venue-type): allow moderated user type edits via interpreter"
```

---

## Task 4: Forward enrich integration (deterministic base + AI override)

**Files:**
- Modify: `lib/ai/extractHappyHours.ts` (tool schema ~143, `RawExtract` ~113, `ExtractResult` ~74, `NormalisedExtract` ~368, `normaliseRawExtract` ~377, `parseRecordedExtract` ~395, `ExtractResult` build in `extractHappyHours` ~427+)
- Modify: `prompts/seed-extract-hh.md`
- Modify: `lib/ai/enrichBatchState.ts:14-25`
- Modify: `scripts/seed-enrich-candidates.ts` (SELECTs ~366 & ~749, ctx builds ~472 & ~800, `insertVenueRow` ~140, `persistExtraction` ~211)

- [ ] **Step 1: Add `venueType` to the extractor tool schema** — in `lib/ai/extractHappyHours.ts`, inside `RECORD_TOOL.input_schema.properties` (alongside `confidence`/`summary`, after line ~185), add:

```ts
      venueType: {
        type: ["string", "null"],
        description:
          "The venue category, ONLY if the site/menu makes it clear (e.g. an explicit " +
          "'dive bar', 'hotel bar', 'brewery taproom', 'wine bar'). One of: restaurant, " +
          "bar, sports_bar, pub, dive_bar, wine_bar, brewery, tasting_room, " +
          "cocktail_lounge, gastropub, club, cafe, hotel_bar, pizzeria, other. " +
          "Null when not clearly stated — do not guess.",
      },
```

- [ ] **Step 2: Carry it through the raw + normalised types** — add `venueType?: string | null;` to `interface RawExtract` (after line ~116), and `venueType: string | null;` to `interface NormalisedExtract` (after line ~373) and to `interface ExtractResult` (after line ~83).

- [ ] **Step 3: Populate it in `normaliseRawExtract`** — in the returned object (lines ~386-391), add after `summary`:

```ts
    venueType: typeof raw.venueType === "string" ? raw.venueType : null,
```

Also add `venueType: null,` to the empty-fallback return in `parseRecordedExtract` (line ~420).

- [ ] **Step 4: Thread it into `ExtractResult`** — in `extractHappyHours` the final `return {…}` (around line ~483) builds the `ExtractResult` from a local `NormalisedExtract` named `parsed`. Add the field right after `summary: parsed.summary,`:

```ts
    venueType: parsed.venueType,
```

- [ ] **Step 5: Prompt note** — in `prompts/seed-extract-hh.md`, add near the schema/output instructions:

```markdown
- **venueType** (optional): set it only if the site clearly states the kind of place
  (e.g. "dive bar", "hotel bar", "taproom", "wine bar"). Otherwise leave it null.
  Never guess the category from the cuisine alone.
```

- [ ] **Step 6: Extend `PrepContext`** — in `lib/ai/enrichBatchState.ts`, add to the `PrepContext` interface (after line ~24 `photoName`):

```ts
  primaryType: string | null;
  types: string[] | null;
```

- [ ] **Step 7: Fetch the Google types in both candidate SELECTs** — in `scripts/seed-enrich-candidates.ts`, change the loop-path SELECT (line ~366) and the batch-path SELECT (line ~749) from:

```ts
      SELECT id, name, google_place_id, address, lat, lng, source_url
```

to:

```ts
      SELECT id, name, google_place_id, address, lat, lng, source_url,
             primary_type, types
```

- [ ] **Step 8: Populate the ctx at both build sites** — in the loop-path `ctx` (lines ~472-483) and the batch-path `ctx` (lines ~800-810), add the two fields after `photoName`:

```ts
          primaryType: candidate.primary_type ?? null,
          types: candidate.types ?? null,
```

(In the batch-path build the variable is `c`, so use `c.primary_type` / `c.types`.)

- [ ] **Step 9: Resolve + write the type in `insertVenueRow`** — in `scripts/seed-enrich-candidates.ts`, import the helper at the top:

```ts
import { deriveVenueType } from "@/lib/places/venueType";
```

Add a `venueType` arg to `insertVenueRow` (the `args` object, ~line 142) typed `venueType: string`, and add it to the INSERT (column list line ~155 and VALUES line ~158):

```ts
      INSERT INTO venues
        (city_id, name, slug, address, lat, lng, google_place_id,
         website_url, phone, price_level, type, status, data_completeness, last_verified_at)
      VALUES
        (${cityId}, ${ctx.name}, ${slug},
         ${ctx.address}, ${ctx.lat}, ${ctx.lng},
         ${ctx.googlePlaceId}, ${ctx.siteUrl}, ${ctx.phone},
         ${ctx.priceLevel}, ${args.venueType}::venue_type, 'active'::venue_status,
         ${completeness}::data_completeness, ${lastVerified}::timestamptz)
```

- [ ] **Step 10: Compute base + override + fill-on-conflict in `persistExtraction`** — in `persistExtraction` (lines ~211-241), compute the type before calling `insertVenueRow` and fill it on the existing-venue path. Replace the `insertVenueRow` call (lines ~226-231) and add the fill-up:

```ts
  const base = deriveVenueType({
    primaryType: ctx.primaryType,
    types: ctx.types,
    name: ctx.name,
  });
  // A confident extractor venueType (finer than the Google base) overrides it.
  const finalType =
    extracted?.venueType && isVenueType(extracted.venueType) ? extracted.venueType : base;

  const venueId = await insertVenueRow(sql, {
    cityId,
    ctx,
    completeness,
    lastVerified,
    venueType: finalType,
  });

  // insertVenueRow uses ON CONFLICT DO NOTHING, so a pre-existing venue keeps its row.
  // Fill type only when it's still empty — never clobber a human/AI-refined value.
  if (venueId) {
    await sql`UPDATE venues SET type = ${finalType}::venue_type, updated_at = now()
              WHERE id = ${venueId} AND type IS NULL`;
  }
```

Add the import for `isVenueType` to the same top-of-file import line:

```ts
import { deriveVenueType, isVenueType } from "@/lib/places/venueType";
```

- [ ] **Step 11: Typecheck + lint**

Run: `npm run typecheck && npx eslint lib/ai/extractHappyHours.ts lib/ai/enrichBatchState.ts scripts/seed-enrich-candidates.ts`
Expected: clean (pre-existing issues aside).

- [ ] **Step 12: Commit**

```bash
git add lib/ai/extractHappyHours.ts lib/ai/enrichBatchState.ts scripts/seed-enrich-candidates.ts prompts/seed-extract-hh.md
git commit -m "feat(venue-type): set type on enrich (Google base + confident AI override)"
```

---

## Task 5: Backfill script — Phase 1 deterministic + Phase 2 AI refine

**Files:**
- Create: `scripts/backfill-venue-types.ts`
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add the npm script** — in `package.json`, after the `test:venue-type` line, add:

```json
    "backfill:venue-types": "tsx scripts/backfill-venue-types.ts",
```

- [ ] **Step 2: Write the script** — create `scripts/backfill-venue-types.ts`:

```ts
/**
 * Backfill venues.type. Phase 1 (always): deterministic Google-type map + name-keyword
 * fallback via deriveVenueType. Phase 2 (default on, --no-ai to skip): a cheap Haiku
 * pass using NAME + Google types only (no web fetch) to upgrade obvious finer types.
 *
 *   npm run backfill:venue-types -- [--city <slug>] [--no-ai] [--dry-run] [--limit N]
 *
 * Idempotent. Phase 2 fails safe to the Phase-1 base (and skips entirely without
 * ANTHROPIC_API_KEY). Records Phase 2 spend to ai_usage_ledger (stage 'seed').
 */
import "dotenv/config";
import postgres from "postgres";
import { deriveVenueType, isVenueType, VENUE_TYPES } from "@/lib/places/venueType";
import { anthropic } from "@/lib/ai/anthropic";
import { MODELS } from "@/lib/ai/models";
import { costCents } from "@/lib/ai/pricing";
import { recordUsage } from "@/lib/ai/ledger";

type Sql = ReturnType<typeof postgres>;

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    city: get("--city") ?? null,
    noAi: a.includes("--no-ai"),
    dryRun: a.includes("--dry-run"),
    limit: get("--limit") ? Number(get("--limit")) : null,
  };
}

interface Row {
  id: string;
  name: string;
  city_id: string;
  type: string | null;
  primary_type: string | null;
  types: string[] | null;
}

async function loadRows(sql: Sql, city: string | null, limit: number | null): Promise<Row[]> {
  const cityFilter = city
    ? sql`AND v.city_id = (SELECT id FROM cities WHERE slug = ${city})`
    : sql``;
  const limitClause = limit != null ? sql`LIMIT ${limit}` : sql``;
  return sql<Row[]>`
    SELECT v.id, v.name, v.city_id, v.type::text AS type,
           sc.primary_type, sc.types
    FROM venues v
    LEFT JOIN seed_candidates sc ON sc.google_place_id = v.google_place_id
    WHERE v.deleted_at IS NULL ${cityFilter}
    ORDER BY v.created_at ASC
    ${limitClause}
  `;
}

function distribution(rows: { type: string | null }[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const r of rows) {
    const k = r.type ?? "(null)";
    d[k] = (d[k] ?? 0) + 1;
  }
  return d;
}

async function phase1(sql: Sql, rows: Row[], dryRun: boolean): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  let writes = 0;
  for (const r of rows) {
    const t = deriveVenueType({ primaryType: r.primary_type, types: r.types, name: r.name });
    resolved.set(r.id, t);
    if (t !== r.type) {
      writes++;
      if (!dryRun) {
        await sql`UPDATE venues SET type = ${t}::venue_type, updated_at = now() WHERE id = ${r.id}`;
      }
    }
  }
  console.log(`Phase 1: ${writes} venue(s) ${dryRun ? "would change" : "updated"}.`);
  return resolved;
}

const REFINE_SYSTEM =
  "You categorize a bar/restaurant into exactly one type from a fixed list, using only " +
  "its name and Google place types. Reply with ONLY the single type token, nothing else. " +
  "Allowed: " + VENUE_TYPES.join(", ") + ". " +
  "Only choose a finer type (dive_bar, hotel_bar, sports_bar, cocktail_lounge, gastropub) " +
  "when the name/types make it obvious; otherwise repeat the base type you are given.";

async function refineOne(
  r: Row,
  base: string,
): Promise<{ type: string; inTok: number; outTok: number } | null> {
  const user =
    `Name: ${r.name}\n` +
    `Google primary type: ${r.primary_type ?? "(none)"}\n` +
    `Google types: ${(r.types ?? []).join(", ") || "(none)"}\n` +
    `Base type (your default if unsure): ${base}\n` +
    `Answer with one allowed type token.`;
  const resp = await anthropic().messages.create({
    model: MODELS.classifier,
    max_tokens: 16,
    system: REFINE_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .toLowerCase();
  const picked = isVenueType(text) ? text : base;
  return {
    type: picked,
    inTok: resp.usage.input_tokens,
    outTok: resp.usage.output_tokens,
  };
}

async function phase2(
  sql: Sql,
  rows: Row[],
  base: Map<string, string>,
  dryRun: boolean,
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Phase 2: skipped (no ANTHROPIC_API_KEY).");
    return;
  }
  let upgrades = 0;
  let inTok = 0;
  let outTok = 0;
  const cityIds = new Set<string>();
  for (const r of rows) {
    const b = base.get(r.id)!;
    let res: Awaited<ReturnType<typeof refineOne>> = null;
    try {
      res = await refineOne(r, b);
    } catch (err) {
      console.error(`  refine error for ${r.name}:`, err);
      continue; // fail safe: keep base
    }
    if (!res) continue;
    inTok += res.inTok;
    outTok += res.outTok;
    cityIds.add(r.city_id);
    if (res.type !== b) {
      upgrades++;
      console.log(`  ${r.name}: ${b} -> ${res.type}`);
      if (!dryRun) {
        await sql`UPDATE venues SET type = ${res.type}::venue_type, updated_at = now() WHERE id = ${r.id}`;
      }
    }
  }
  const cents = costCents(MODELS.classifier, { inputTokens: inTok, outputTokens: outTok });
  console.log(`Phase 2: ${upgrades} upgrade(s), ~${cents}¢ (${inTok}in/${outTok}out tokens).`);
  if (!dryRun && (inTok > 0 || outTok > 0)) {
    await recordUsage({
      stage: "seed",
      model: MODELS.classifier,
      usage: { inputTokens: inTok, outputTokens: outTok },
      costCents: cents,
      cityId: cityIds.size === 1 ? [...cityIds][0] : undefined,
    });
  }
}

async function main() {
  const args = parseArgs();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = postgres(process.env.DATABASE_URL);
  try {
    const rows = await loadRows(sql, args.city, args.limit);
    console.log(`Loaded ${rows.length} venue(s)${args.city ? ` for '${args.city}'` : ""}.`);
    console.log("Before:", distribution(rows));

    const base = await phase1(sql, rows, args.dryRun);
    if (!args.noAi) await phase2(sql, rows, base, args.dryRun);

    const after = await loadRows(sql, args.city, args.limit);
    console.log("After:", distribution(after));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify the cost helper + ledger signatures** — confirm imports resolve:

Run: `npm run typecheck`
Expected: clean. (If `costCents`'s `Usage` field names differ, match `lib/ai/anthropic.ts`'s `Usage` — it is `{ inputTokens, outputTokens }`.)

- [ ] **Step 4: Lint**

Run: `npx eslint scripts/backfill-venue-types.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-venue-types.ts package.json
git commit -m "feat(venue-type): backfill script (deterministic + cheap AI refine)"
```

---

## Task 6: Run the backfill + final verification

**Files:** none (operational + acceptance gates). Requires Docker postgis up.

- [ ] **Step 1: Dry-run to preview the distribution**

Run: `npm run backfill:venue-types -- --no-ai --dry-run`
Expected: prints `Before:` (all `(null)`) and `After:` distributions; Phase 1 reports the would-change count ≈ total venue count; **no rows written**.

- [ ] **Step 2: Sanity-check a few specific venues in the dry-run output**

Run (spot check the 69 no-Google-type venues map sensibly):
```bash
source .env; psql "$DATABASE_URL" -c "SELECT v.name, sc.primary_type, sc.types FROM venues v LEFT JOIN seed_candidates sc ON sc.google_place_id=v.google_place_id WHERE v.deleted_at IS NULL AND (sc.primary_type IS NULL) LIMIT 10;"
```
Expected: confirms the name-keyword/default reasoning (e.g. "Harmon Brewing" → brewery, "Stanley & Seafort's" → restaurant).

- [ ] **Step 3: Run Phase 1 for real (deterministic only first)**

Run: `npm run backfill:venue-types -- --no-ai`
Expected: `Phase 1: N updated.`; `After:` shows zero `(null)` and a spread across enum types.

- [ ] **Step 4: Confirm no NULL types remain**

Run: `source .env; psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE type IS NULL) AS nulls, count(*) AS total FROM venues WHERE deleted_at IS NULL;"`
Expected: `nulls = 0`.

- [ ] **Step 5: Run Phase 2 AI refine (needs ANTHROPIC_API_KEY)** — if a key is present:

Run: `npm run backfill:venue-types`
Expected: Phase 1 reports 0 changes (idempotent), Phase 2 prints upgrades + a cents total and records one `ai_usage_ledger` row. Without a key: Phase 2 prints `skipped (no ANTHROPIC_API_KEY)` — acceptable; Phase-1 coverage already removes all dashes.

- [ ] **Step 6: Run the unit test + full acceptance gates**

Run: `npm run test:venue-type && npm run typecheck && npm run build`
Expected: test prints all `✓`; typecheck clean; build compiles (the known benign Turbopack NFT warning is fine).

- [ ] **Step 7: Eyeball the app**

Run: `npm run dev` → open `/tacoma` (and a venue page). Confirm the Type column/badge show friendly labels (Dive, Cocktails, Brewery, …), the type filter chips read as labels, and no `—` remains in the Type column for active venues.

- [ ] **Step 8: Commit any final notes** (no code expected here). If CLAUDE.md status needs updating, do it in a separate docs commit.

---

## Self-Review

**Spec coverage:**
- `lib/places/venueType.ts` (map, keywords, default, labels, guard) → Task 1. ✓
- Friendly labels in grid + venue page → Task 2. ✓
- User-suggested type edits (interpreter `type` field, `venueStateJson`, enum validation, prompt) → Task 3. ✓
- Forward enrich integration (tool schema, `PrepContext`, SELECTs, insert, fill-on-conflict) → Task 4. ✓
- Backfill script Phase 1 + Phase 2 AI refine, `--city`/`--no-ai`/`--dry-run` → Task 5. ✓
- Run + acceptance gates → Task 6. ✓
- No migration / enum unchanged → honored (no migration task). ✓
- Tests: `deriveVenueType` table, labels exhaustiveness, `labelForVenueType(null)==""`, interpreter enum-strip → Tasks 1 & 3. ✓

**Deviation from spec, intentional:** the spec said enrich should add `type` to `ON CONFLICT … DO UPDATE`. The existing `insertVenueRow` relies on `ON CONFLICT DO NOTHING` to detect pre-existing venues; flipping to `DO UPDATE` would change that control flow. Task 4 Step 10 instead writes `type` on fresh inserts and does a guarded `UPDATE … WHERE type IS NULL` for the conflict path — same intent ("re-enrich keeps it fresh"), but it never clobbers a human/AI-refined value, which is strictly better.

**Type consistency:** `VenueType`, `VENUE_TYPES`, `deriveVenueType`, `isVenueType`, `labelForVenueType`, `VENUE_TYPE_LABELS` used identically across tasks. `Usage` shape `{ inputTokens, outputTokens }` matches `lib/ai/anthropic.ts`. `recordUsage` stage `"seed"` is a valid `LedgerStage`. `costCents(model, usage)` import path `@/lib/ai/pricing` matches existing callers.

**Placeholder scan:** none — every code step is concrete. (The one annotated `coffee_shop` ternary in Task 1 Step 4 is explicitly corrected to a plain mapping in Step 5.)
