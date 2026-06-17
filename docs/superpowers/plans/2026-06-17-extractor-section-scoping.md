# Extractor Section-Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the HH extractor from mis-attributing offerings across page sections by preserving section structure in `stripHtml`, teaching the prompt to scope to the happy-hour section, locking it with golden fixtures, and cleaning the 3 affected live venues.

**Architecture:** `stripHtml` currently flattens all tags + whitespace into one line, destroying the heading/section signal the model needs. We convert headings to `## ` markers and block boundaries to newlines *before* the blanket tag-strip, preserve line breaks, add a prompt rule (v20) that records offerings only under the HH section, and verify with deterministic golden fixtures + a live re-extract of the 3 venues.

**Tech Stack:** TypeScript, `tsx` standalone test scripts (`node:assert/strict`, no test framework), Drizzle/postgres.js, Anthropic Sonnet extractor, versioned prompts in `prompts/`.

---

## File Structure

- `lib/verification/fetchUrl.ts` — modify `stripHtml()` (section-structure preservation). Load-bearing: all extraction flows through it.
- `scripts/test-striphtml-sections.ts` — **create**. Inline-HTML unit test for the transform.
- `scripts/fixtures/section-scoping/*.html` — **create**. Saved real pages (Alcazar, Black Sheep, State Street).
- `scripts/test-section-scoping-fixtures.ts` — **create**. Deterministic golden over the real fixtures (structure-preservation assertions).
- `scripts/ci-tests.sh` — modify. Register the two new tests.
- `prompts/seed-extract-hh.md` — modify. Bump to v20, add the section-scoping rule.

---

## Task 1: Preserve section structure in `stripHtml`

**Files:**
- Modify: `lib/verification/fetchUrl.ts` (`stripHtml`, ~line 174–229)
- Test: `scripts/test-striphtml-sections.ts` (create)
- Modify: `scripts/ci-tests.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-striphtml-sections.ts`:

```typescript
/**
 * test-striphtml-sections — guards section-structure preservation in stripHtml.
 * Run: pnpm tsx scripts/test-striphtml-sections.ts  (exits non-zero on any failure)
 *
 * stripHtml used to flatten every tag + whitespace run into ONE line, so the model could
 * not tell which priced items sat under the Happy Hour heading vs a cocktail menu / footer.
 * That mis-attributed offerings (Alcazar, Black Sheep). We now convert headings to "## "
 * markers and block boundaries to newlines so the section signal survives.
 */
import assert from "node:assert/strict";
import { stripHtml } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Mirrors the Alcazar failure: a Signature Cocktails section ABOVE the HH section, plus a
// footer Location line — all of which were collapsed into the HH window before this fix.
const page = `<html><body>
<h2>Signature Cocktails</h2><ul><li>Spanish Gin $17</li><li>Blueberry Mint Lemondrop $17</li></ul>
<h2>Happy Hour 4:30-6pm</h2><ul><li>Heat of Passion $14</li><li>Alcazar Sangria $12</li></ul>
<footer><p>Location: 1812 Cliff Dr</p></footer>
</body></html>`;

check("headings become ## markers", () => {
  const t = stripHtml(page);
  assert.match(t, /## Signature Cocktails/);
  assert.match(t, /## Happy Hour 4:30-6pm/);
});

check("output is multi-line, not one flat run", () => {
  const t = stripHtml(page);
  assert.ok(t.includes("\n"), "expected newlines to survive");
});

check("cocktail-menu items sit BEFORE the HH heading", () => {
  const t = stripHtml(page);
  assert.ok(t.indexOf("Spanish Gin") < t.indexOf("## Happy Hour"), "Spanish Gin leaked past HH heading");
});

check("HH items sit AFTER the HH heading and before the footer Location", () => {
  const t = stripHtml(page);
  const hh = t.indexOf("## Happy Hour");
  assert.ok(t.indexOf("Heat of Passion") > hh, "Heat of Passion not under HH heading");
  assert.ok(t.indexOf("Location") > t.indexOf("Alcazar Sangria"), "footer Location not separated");
});

check("block boundaries without headings still break onto lines (div-soup sites)", () => {
  // Wix/Squarespace render labels as styled divs, not <h2>. Block-boundary breaking must
  // still separate items so "Happy Hour 4-6" sits on its own line as a pseudo-heading.
  const divSoup = `<div>Happy Hour 4-6pm</div><div>Well drinks $6</div><div>Open daily 9am-1pm</div>`;
  const t = stripHtml(divSoup);
  assert.ok(t.includes("\n"), "div boundaries did not break onto lines");
  assert.ok(t.indexOf("Open daily") > t.indexOf("Well drinks"), "lines out of order");
});

check("regression: scripts/styles still dropped, entities still decoded", () => {
  const t = stripHtml(`<html><head><style>.x{}</style></head><body><script>var x=1</script><p>Tacos &amp; Beer</p></body></html>`);
  assert.ok(!/var x=1|\.x\{/.test(t), "script/style leaked");
  assert.match(t, /Tacos & Beer/);
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-striphtml-sections.ts`
Expected: FAIL — `## Signature Cocktails` not found (current `stripHtml` strips the `<h2>` and collapses to one line).

- [ ] **Step 3: Implement the transform**

In `lib/verification/fetchUrl.ts`, in `stripHtml`, insert a structure-preservation step **between** step 1 (noise drop) and step 2 (tag strip). The current step 1 ends with the `data:` base64 replace; step 2 is `text = text.replace(/<[^>]+>/g, " ");`. Add before step 2:

```typescript
  // 1b. Preserve section structure BEFORE the blanket tag strip. Headings → "## " markers,
  //     block boundaries → newlines. Without this the page collapses to one flat line and
  //     offerings get mis-attributed across sections (Alcazar's $17 cocktails / $40 bottle /
  //     footer "Location" all landed in the Happy Hour window). div/section breaks cover
  //     Wix/Squarespace sites that render labels as styled divs, not <h*>.
  text = text
    .replace(/<h[1-6]\b[^>]*>/gi, "\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|tr|div|section|article|header|footer|ul|ol|table)\s*>/gi, "\n");
```

Then change step 4 (currently `text = text.replace(/\s+/g, " ").trim();`) to collapse intra-line whitespace while PRESERVING line breaks:

```typescript
  // 4. Collapse intra-line whitespace but PRESERVE the line breaks from step 1b (the
  //    section signal). Cap blank-line runs so payload stays tight.
  text = text
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
```

Leave steps 4b/4c (harvestScriptText/harvestJsonLdMenu — they parse the original `html`, unaffected) and step 5 (budget windowing — offset-based, newline-agnostic) as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-striphtml-sections.ts`
Expected: PASS — `7 checks passed.`

- [ ] **Step 5: Run the existing harvest + golden suites (regression guard)**

Run: `pnpm test:harvest && pnpm test:hh-golden`
Expected: both PASS. If `test:hh-golden` fails on a window-shape diff, inspect whether the newline change altered budget-trim ordering for a fixture; fix `stripHtml` (not the fixture) unless the new output is genuinely correct.

- [ ] **Step 6: Register the test in CI**

In `scripts/ci-tests.sh`, add to the `TESTS=( … )` array (near `test:harvest`):

```bash
  test:striphtml-sections
```

And add the script to `package.json` `scripts`:

```json
    "test:striphtml-sections": "tsx scripts/test-striphtml-sections.ts",
```

- [ ] **Step 7: Commit**

```bash
git add lib/verification/fetchUrl.ts scripts/test-striphtml-sections.ts scripts/ci-tests.sh package.json
git commit -m "fix(extract): preserve section structure in stripHtml"
```

---

## Task 2: Real-page golden fixtures (deterministic, $0)

**Files:**
- Create: `scripts/fixtures/section-scoping/alcazar.html`, `black-sheep.html`, `state-street.html`
- Create: `scripts/test-section-scoping-fixtures.ts`
- Modify: `scripts/ci-tests.sh`, `package.json`

- [ ] **Step 1: Save the real pages as fixtures**

Fetch with our bot UA and inspect the markup FIRST (confirm whether sections use `<h*>` or styled `<div>`s — this dictates whether assertions key on `## ` or on line-separation):

```bash
mkdir -p scripts/fixtures/section-scoping
UA="HappyHourFriendsBot/1.0 (+https://happyhourfriends.com)"
curl -sL -A "$UA" "https://alcazartapasbar.com/menu-1-2" -o scripts/fixtures/section-scoping/alcazar.html
curl -sL -A "$UA" "https://blacksheepsb.com/happyhour-menu" -o scripts/fixtures/section-scoping/black-sheep.html
# Identify State Street's actual HH page first; statestreetbeer.com/menu was the stored source.
curl -sL -A "$UA" "https://www.statestreetbeer.com/menu" -o scripts/fixtures/section-scoping/state-street.html
```

Then inspect: `grep -ioE '<h[1-6]|happy hour' scripts/fixtures/section-scoping/alcazar.html | head`. If a page is JS-walled (no HH text in raw HTML), note it in the test comment and rely on the `harvestScriptText`/`harvestJsonLdMenu` path; if even that is empty, drop that fixture and record why (do not fabricate a fixture).

- [ ] **Step 2: Write the deterministic golden test**

Create `scripts/test-section-scoping-fixtures.ts`. It asserts the ENABLER (structure survives on real pages) — not model keep/drop, which is validated by the live re-extract in Task 4:

```typescript
/**
 * test-section-scoping-fixtures — deterministic ($0) golden over real pages that the
 * extractor mis-scoped. Asserts stripHtml now SEPARATES the happy-hour section from the
 * surrounding cocktail menu / footer / homepage marketing. Model keep/drop behavior is
 * validated separately by the live 3-venue re-extract (see the plan, Task 4).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripHtml } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const load = (f: string) => stripHtml(readFileSync(`scripts/fixtures/section-scoping/${f}`, "utf8"));

check("alcazar: HH label and Signature Cocktails are on separate lines", () => {
  const t = load("alcazar.html");
  assert.ok(t.includes("\n"), "flattened to one line");
  assert.match(t, /happy hour/i);
  // The $40 bottle / $17 signature cocktails must not share a line with the HH label.
  const hhLine = t.split("\n").find((l) => /happy hour/i.test(l)) ?? "";
  assert.ok(!/\$40|\$17/.test(hhLine), `HH label line carried out-of-section prices: "${hhLine}"`);
});

check("black-sheep: HH page text has no 9am-1pm / $55 brunch on the HH line", () => {
  const t = load("black-sheep.html");
  const hhLine = t.split("\n").find((l) => /happy hour/i.test(l)) ?? "";
  assert.ok(!/9\s*am|\$55/i.test(hhLine), `HH label line carried brunch/hours: "${hhLine}"`);
  assert.match(t, /41/); // the $41 prix-fixe IS on this page
});
```

Adapt the exact assertions to what Step 1's inspection shows (e.g. if a page uses `<h*>`, also assert `/## .*happy hour/i`). Keep assertions about *structure/separation*, not exact model output.

- [ ] **Step 3: Run the test**

Run: `pnpm tsx scripts/test-section-scoping-fixtures.ts`
Expected: PASS. If a fixture was dropped in Step 1 (JS-walled), its `check(...)` is removed and the reason noted in the file header.

- [ ] **Step 4: Register + commit**

`package.json`: `"test:section-scoping-fixtures": "tsx scripts/test-section-scoping-fixtures.ts",`
`scripts/ci-tests.sh`: add `test:section-scoping-fixtures` to `TESTS`.

```bash
git add scripts/fixtures/section-scoping scripts/test-section-scoping-fixtures.ts scripts/ci-tests.sh package.json
git commit -m "test(extract): real-page section-scoping golden fixtures"
```

---

## Task 3: Prompt v20 — section scoping

**Files:**
- Modify: `prompts/seed-extract-hh.md` (frontmatter `version` + `notes`; body rule)

- [ ] **Step 1: Add the section-scoping rule to the prompt body**

In the rules list of `prompts/seed-extract-hh.md` (after the THIS-LOCATION-ONLY block), add:

```markdown
- SECTION SCOPING. The page text is delimited into sections: a line beginning with `## `
  is a heading, and a short label line directly above a run of items (e.g.
  "Happy Hour 4:30-6pm") also starts a section. Record an offering ONLY when it appears
  within the happy-hour section/heading (or directly under a stated HH window). Do NOT
  pull items from a separate section even when priced and on the same page:
  - a full drink/food menu or "Signature Cocktails" list under its own heading,
  - regular menu pricing outside the HH section, including a wine's standard glass/bottle
    price (e.g. a "$40 bottle" listed under "Other Offerings" is regular pricing, not HH),
  - footer / operating-hours / address text (e.g. "Open 9am-1pm", a "Location" line),
  - homepage feature-marketing (brunch, weekly specials) that is not part of the HH list.
- A bottle CAN be a happy hour when it is explicitly discounted or wrapped into a day/HH
  special WITHIN the HH section (e.g. "half-price bottles", "$20 bottles Monday"). The
  test is section + explicit discount, never the word "bottle" — record those.
- A happy-hour WINDOW's day/time must come from stated HH schedule text near the
  offerings. NEVER manufacture a window from the venue's operating hours or from marketing
  copy (a "9am-1pm" line in the footer is open hours, not a happy hour).
```

- [ ] **Step 2: Bump the version + changelog in frontmatter**

Change `version: 19` → `version: 20`. Prepend to the `notes:` value:

```
v20 — SECTION-SCOPING (2026-06-17): stripHtml now preserves section structure (## headings + line breaks); record offerings only under the happy-hour section, never from a separate cocktail/full menu, regular bottle/glass pricing, footer/operating-hours, or homepage marketing. A discounted/HH-section bottle IS valid (Postino's pattern). Never build a window from operating hours (Alcazar pulled $17 signature cocktails + a $40 bottle into HH; Black Sheep built a bogus 9am-1pm window from the homepage). v19 — …
```

- [ ] **Step 3: Verify the prompt loads and the hash recomputes**

Run: `pnpm typecheck`
Expected: PASS (prompt is read at runtime; this confirms nothing imports a stale constant). The `prompt_hash` is recomputed from file content on next use — no code change needed.

- [ ] **Step 4: Commit**

```bash
git add prompts/seed-extract-hh.md
git commit -m "feat(extract): prompt v20 — scope offerings to the happy-hour section"
```

---

## Task 4: Apply to the 3 live venues (re-extract + clean) — PAID, operator reviews

**Files:** none (data operations). Venue IDs:
- Alcazar Tapas Bar — `b7f3e2df-ec6d-4335-92ab-e349f4068a48` (re-extract from `https://alcazartapasbar.com/menu-1-2`)
- The Black Sheep Restaurant + Bar — `a45897e3-f7da-45df-aca8-b6785d5f8195` (re-extract from `https://blacksheepsb.com/happyhour-menu`)
- State Street (Tacoma) — `1c094098-dad8-4bc6-9fea-af5f55a98c5b` (re-extract from its HH page; confirm URL)

- [ ] **Step 1: Snapshot the current (bad) rows for before/after**

```bash
docker compose exec -T db psql -U hhf -d happyhourfriends -tA -F' | ' -c "
SELECT v.name, hh.id, hh.active, hh.days_of_week, hh.start_time, hh.end_time, o.name, o.price_cents, hh.source_url
FROM venues v JOIN happy_hours hh ON hh.venue_id=v.id LEFT JOIN offerings o ON o.happy_hour_id=hh.id
WHERE v.id IN ('b7f3e2df-ec6d-4335-92ab-e349f4068a48','a45897e3-f7da-45df-aca8-b6785d5f8195','1c094098-dad8-4bc6-9fea-af5f55a98c5b')
ORDER BY v.name, hh.active DESC, hh.start_time;"
```

- [ ] **Step 2: Re-extract each venue from its correct first-party HH URL (PAID ~$0.10 total)**

```bash
pnpm reextract:stubs --venue b7f3e2df-ec6d-4335-92ab-e349f4068a48 --url "https://alcazartapasbar.com/menu-1-2"
pnpm reextract:stubs --venue a45897e3-f7da-45df-aca8-b6785d5f8195 --url "https://blacksheepsb.com/happyhour-menu"
pnpm reextract:stubs --venue 1c094098-dad8-4bc6-9fea-af5f55a98c5b --url "<state-street-hh-url>"
```

(Confirm the `reextract:stubs --venue <id> --url <url>` flags against `scripts/reextract-stubs.ts` before running; the same-time window is superseded by the canonical reconcile, so Alcazar's 4:30-6pm offerings are replaced.)

- [ ] **Step 3: Soft-delete leftover bogus windows the re-extract did not supersede**

Black Sheep's 9am-1pm window (source = homepage) does NOT match the 5-6pm HH window, so reconcile leaves it. Confirm it (and any other non-HH-source active window) then soft-delete via the canonical path. Identify candidates:

```bash
docker compose exec -T db psql -U hhf -d happyhourfriends -tA -F' | ' -c "
SELECT hh.id, hh.start_time, hh.end_time, hh.source_url
FROM happy_hours hh WHERE hh.venue_id='a45897e3-f7da-45df-aca8-b6785d5f8195' AND hh.active
  AND hh.source_url NOT ILIKE '%happyhour-menu%';"
```

Soft-delete the confirmed-bogus window id(s) (set `active=false, deleted_at=now()`) so operator deletes are never resurrected. Use the admin delete path / `regate --apply` demotion if it flags them; otherwise a targeted UPDATE on the listed ids.

- [ ] **Step 4: Re-snapshot and eyeball with the operator**

Re-run the Step 1 query. Confirm against ground truth: Alcazar shows Heat of Passion/$14, Alcazar Sangria/$12, House wines, Cava and NO $40/$17/Location; Black Sheep shows the 5-6pm window with $41 prix-fixe + real items and NO 9am-1pm/$55; State Street keeps $1-off pints and drops the $15 bottle line. **Stop and have the operator confirm before considering this done.**

- [ ] **Step 5: Optional — regate as backstop**

Run: `pnpm regate --city santa-barbara --state ca` (dry-run, $0) and `pnpm regate --city tacoma --state wa`. Apply only if it surfaces a correct promote/demote: `pnpm regate --apply`.

---

## Self-Review

- **Spec coverage:** stripHtml structure (Task 1) ✓; prompt v20 (Task 3) ✓; golden fixtures precision+recall — Tier-1 deterministic in Task 2, Tier-2 keep/drop via live re-extract in Task 4 ✓; apply to 3 venues only (Task 4) ✓; bottle nuance in prompt (Task 3) ✓. Future items (broader re-extract, data-sanity pass, gate backstop) intentionally not tasked.
- **Placeholder scan:** `<state-street-hh-url>` and `<bogus window id>` are runtime-discovered values, flagged with the command that finds them — not plan placeholders.
- **Type/name consistency:** test script names match `package.json` keys and `ci-tests.sh` entries (`test:striphtml-sections`, `test:section-scoping-fixtures`); venue IDs consistent across tasks.
