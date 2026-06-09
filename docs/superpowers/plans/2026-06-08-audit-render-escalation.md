# Audit Render-Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, cost-gated render-escalation step to `audit:fix` that recovers happy-hour menus hidden behind JS/PDF pages (e.g. Oeste's `/happy-hour-menu` PDF) — keyed on one uniform "unread HH page" signal that covers stubs and flagged venues alike — and applies the recovered windows + offerings reversibly, after a preview report.

**Architecture:** A pure detector `needsRenderEscalation` decides "this venue has an HH-specific page the free pass couldn't read." `audit:fix --escalate-paid` runs the free pass over candidate venues (stubs ∪ flagged, $0), and for escalating ones either previews (paid extract → review report, no DB write) or applies (paid extract → persist windows+offerings via the existing audited path + soft-deactivate superseded windows). All paid work is opt-in and ledgered.

**Tech Stack:** TypeScript (strict) · tsx scripts · postgres.js · Node `assert/strict` tests. Reuses `lib/ai/extractHappyHours` (paid, render-on), `lib/ai/freeExtract`, `lib/places/siteTriage`, `lib/places/hhText` (`scoreHhUrl`), `lib/audit/anomalyRules` (`isHighConfidenceCorrection`), `lib/audit/computeCorrection`, `lib/recover/resolveVenue` (`persistExtractedWindows`).

**Spec:** `docs/superpowers/specs/2026-06-08-audit-render-escalation-design.md`

---

## Background facts the engineer needs (verified against the code)

- **Worktree:** all work in `/Users/stevenmatthiesen/Personal/hhf-audit` (branch `feat/data-anomaly-audit`). Bash cwd RESETS per call — prefix every command with `cd /Users/stevenmatthiesen/Personal/hhf-audit && ...`. Use **pnpm**. `.env` present; Docker Postgres up; `ANTHROPIC_API_KEY` set.
- **`scoreHhUrl(url): number`** (`lib/places/hhText.ts`) > 0 ⇒ URL path looks HH-specific (`/happy-hour-menu` scores > 0).
- **The free pass** (copy from `scripts/audit-fix.ts`): `triageSite({websiteUri,name,cityName})` → `resolveEnrichAction(verdict, hhLikelihood({primaryType:null,types:null,name}))` → `decided.priorityUrls` (string[], triage-ranked) → `buildExtractRequest({venueName, websiteUrl: verdict.kind==='real'?verdict.url:null, otherUrl:null, cityName, priorityUrls: decided.priorityUrls, noRender:true})` → returns `{ pages: FetchedPage[], promptHash, ... }` where each `FetchedPage` has `.url` (the pages the free pass actually read) → `freeExtractFromPages(built.pages, {model:'deterministic-html-v1', promptHash: built.promptHash})` → `ExtractResult | null`.
- **The paid extractor** `extractHappyHours(input): Promise<ExtractResult>` (`lib/ai/extractHappyHours.ts`) — input `{venueName, websiteUrl, otherUrl:null, cityName, priorityUrls}`; render is ON by default (reads PDFs/images). Returns `ExtractResult = { happyHours: ExtractedHappyHour[], confidence, summary?, usage, costCents, promptHash, model }`. `ExtractedHappyHour = { daysOfWeek, startTime, endTime, allDay, timeKnown, locationWithinVenue, notes, sourceUrl, suspect?, offerings: ExtractedOffering[] }`.
- **Persist (the ONE path)** `persistExtractedWindows({venueId, cityId, extracted: ExtractResult, actor})` (`lib/recover/resolveVenue.ts`) inserts windows + offerings, runs reconcile + realness gates, promotes to `complete`, ledgers spend, writes `audit_log`. ON CONFLICT DO NOTHING (won't update an existing same-key row).
- **Deactivation set** `computeCorrection(stored: StoredRow[], corrected: CorrectedWindow[]).deactivations` (`lib/audit/computeCorrection.ts`) = ids of active stored rows whose natural key isn't in `corrected`. `StoredRow`/`CorrectedWindow` shapes are in that file. Time keys are normalized (HH:MM vs HH:MM:SS) already.
- **High-confidence gate** `isHighConfidenceCorrection(corrected: Omit<AuditWindow,'active'>[])` (`lib/audit/anomalyRules.ts`) — true when every window has real days, ≥1 HH-specific source, reconcile keeps all.
- **`closeRenderBrowser()`** (`lib/verification/renderUrl.ts`) — call once in a `finally` to free Chromium after a paid run.
- **Existing `audit:fix` structure** (`scripts/audit-fix.ts`): `requireCityArgs()` + `resolveCity`, postgres.js client, per-venue loop, `arg('--flag')` helper, `APPLY = process.argv.includes('--apply')`. The escalation extends this file.
- **Oeste ground truth:** venue id `1f0f4933-0878-4600-bac4-77dedc05f34d`; website `http://www.oesteoakland.com/`; HH page `/happy-hour-menu` (renders to a PDF); currently 2 active homepage windows (Tue–Sun 11:00–15:30, 17:00–19:00) with **no offerings**.

---

## File Structure

- **Create** `lib/audit/renderEscalation.ts` — pure detector `needsRenderEscalation`. One responsibility: decide "unread HH page."
- **Create** `scripts/test-render-escalation.ts` — runnable unit test for the detector (pure, `$0`, in CI).
- **Modify** `scripts/audit-fix.ts` — add the `--escalate-paid` candidate loop with four modes (dry-run / `--preview` / `--apply` / `--apply-from`), the review-report writer, and the apply (persist + deactivate). This is the one script that owns the escalation flow.
- **Modify** `package.json` — add `test:render-escalation`.
- **Modify** `scripts/ci-tests.sh` — add `test:render-escalation`.

---

## Task 1: `needsRenderEscalation` detector (pure, unit-tested)

**Files:**
- Create: `lib/audit/renderEscalation.ts`
- Create test: `scripts/test-render-escalation.ts`

- [ ] **Step 1: Write the failing test** (`scripts/test-render-escalation.ts`)

```typescript
/**
 * Unit checks for the pure render-escalation detector (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-render-escalation.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { needsRenderEscalation } from "@/lib/audit/renderEscalation";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// Oeste: triage found /happy-hour-menu (HH-specific) but the free pass read only the homepage
// (the HH page is a JS shell → skipped), and the free windows carry no offerings.
check("oeste: unread HH page → escalate (reason unread_hh_page)", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://www.oesteoakland.com/happy-hour-menu", "https://www.oesteoakland.com/menus"],
    readUrls: ["http://www.oesteoakland.com/", "https://www.oesteoakland.com/menus"],
    freeWindows: [{ offerings: [] }, { offerings: [] }],
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "unread_hh_page");
  assert.deepEqual(v.hhPages, ["https://www.oesteoakland.com/happy-hour-menu"]);
});

check("HH page read but free windows have no offerings → escalate (hh_page_no_offerings)", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/happy-hour"],
    readUrls: ["https://x.com/happy-hour"],
    freeWindows: [{ offerings: [] }],
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "hh_page_no_offerings");
});

check("fully captured (HH page read + offerings present) → no escalate", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/happy-hour"],
    readUrls: ["https://x.com/happy-hour"],
    freeWindows: [{ offerings: [{ name: "$5 taco" }] }],
  });
  assert.equal(v.escalate, false);
  assert.equal(v.reason, null);
});

check("no HH-specific page anywhere → no escalate (nothing richer to read)", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/", "https://x.com/about"],
    readUrls: ["https://x.com/"],
    freeWindows: [{ offerings: [] }],
  });
  assert.equal(v.escalate, false);
});

check("stub (no free windows) with an unread HH page → escalate", () => {
  const v = needsRenderEscalation({
    priorityUrls: ["https://x.com/happy-hour-menu"],
    readUrls: ["https://x.com/"],
    freeWindows: null,
  });
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "unread_hh_page");
});

console.log(`\n✓ ${passed} render-escalation checks passed.`);
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm tsx scripts/test-render-escalation.ts`
Expected: FAIL — cannot find module `@/lib/audit/renderEscalation`.

- [ ] **Step 3: Implement `lib/audit/renderEscalation.ts`**

```typescript
/**
 * renderEscalation — pure detector for "this venue has an HH-specific page the free pass
 * could not extract from." The single, uniform trigger for the audit's paid render-escalation
 * (covers stubs AND flagged venues identically). NO DB, NO network, NO AI ($0, unit-tested).
 *
 * Escalate when there is a richer HH source we haven't captured:
 *   - unread_hh_page:      an HH-specific page (scoreHhUrl>0) triage found but the free pass
 *                          never read (a JS shell / PDF the plain fetch skipped).
 *   - hh_page_no_offerings: an HH-specific page was read, but the free windows carry NO
 *                          offerings (times without specials — the specials are likely in a PDF).
 */
import { scoreHhUrl } from "@/lib/places/hhText";

export interface EscalationInput {
  /** Triage-ranked candidate URLs (resolveEnrichAction.priorityUrls). */
  priorityUrls: string[];
  /** URLs the free pass actually read usable content from (built.pages[].url). */
  readUrls: string[];
  /** The free ExtractResult.happyHours (or null when the free pass returned nothing). */
  freeWindows: { offerings: unknown[] }[] | null;
}

export type EscalationReason = "unread_hh_page" | "hh_page_no_offerings";

export interface EscalationVerdict {
  escalate: boolean;
  reason: EscalationReason | null;
  hhPages: string[]; // the HH-specific pages found (for the report)
}

/** Strip a trailing slash so "/x/" and "/x" compare equal. */
function norm(u: string): string {
  return u.replace(/\/+$/, "");
}

export function needsRenderEscalation(input: EscalationInput): EscalationVerdict {
  const hhPages = input.priorityUrls.filter((u) => scoreHhUrl(u) > 0);
  if (hhPages.length === 0) return { escalate: false, reason: null, hhPages: [] };

  const read = new Set(input.readUrls.map(norm));
  const unreadHhPage = hhPages.some((u) => !read.has(norm(u)));
  if (unreadHhPage) return { escalate: true, reason: "unread_hh_page", hhPages };

  const noOfferings =
    !!input.freeWindows &&
    input.freeWindows.length > 0 &&
    input.freeWindows.every((w) => w.offerings.length === 0);
  if (noOfferings) return { escalate: true, reason: "hh_page_no_offerings", hhPages };

  return { escalate: false, reason: null, hhPages };
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm tsx scripts/test-render-escalation.ts`
Expected: `✓ 5 render-escalation checks passed.`

- [ ] **Step 5: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: clean (ignore only pre-existing errors in `db/schema/moderation.ts` / `scripts/import-neighborhoods.ts`).

- [ ] **Step 6: Commit**

```bash
cd /Users/stevenmatthiesen/Personal/hhf-audit && git add lib/audit/renderEscalation.ts scripts/test-render-escalation.ts && git commit -m "feat(audit): needsRenderEscalation detector (unread HH page) + Oeste fixtures"
```

---

## Task 2: `--escalate-paid` candidate loop + free detection + dry-run

**Files:**
- Modify: `scripts/audit-fix.ts`

This task adds the escalation candidate scan WITHOUT any paid call — the free `$0` dry-run that lists what would escalate and the cost estimate. The paid modes come in Tasks 3–4.

- [ ] **Step 1: Add flags + the escalation candidate query + free detection loop**

At the top of `scripts/audit-fix.ts`, after the existing imports, add:

```typescript
import { triageSite as _triageUnused } from "@/lib/places/siteTriage"; // (already imported below; remove if dup)
import { needsRenderEscalation } from "@/lib/audit/renderEscalation";
```
(If `triageSite`, `resolveEnrichAction`, `hhLikelihood`, `buildExtractRequest`, `freeExtractFromPages` are already imported for the existing free fix, reuse those imports — do NOT duplicate. Only add `needsRenderEscalation`.)

After the existing flag parsing, add:

```typescript
const ESCALATE = process.argv.includes("--escalate-paid");
const PREVIEW = process.argv.includes("--preview");
const APPLY_FROM = arg("--apply-from"); // path to a previously-previewed report json
const ESCALATION_COST_EST_USD = 0.05; // ~1 render + 1 Sonnet extract (observed 3–5¢)
```

Add a new function (above `main`) that runs the escalation pass. Start with detection-only:

```typescript
interface EscalationCandidate {
  id: string;
  name: string;
  website_url: string | null;
}

async function runEscalation(sql: postgres.Sql, city: { id: string; name: string; slug: string }) {
  // Candidates: stubs OR audit-flagged venues, with a website. The free check is $0; only
  // venues with an unread HH page proceed to paid.
  const candidates = await sql<EscalationCandidate[]>`
    SELECT v.id, v.name, v.website_url
    FROM venues v
    WHERE v.city_id = ${city.id} AND v.status = 'active' AND v.deleted_at IS NULL
      AND v.website_url IS NOT NULL
      AND (
        v.data_completeness = 'stub'
        OR EXISTS (
          SELECT 1 FROM data_audit da
          WHERE da.venue_id = v.id AND jsonb_array_length(da.flags) > 0
        )
      )
    ORDER BY v.name
    ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

  console.log(`[escalate] ${candidates.length} candidate venue(s) (stubs ∪ flagged) in ${city.name}. Free detection — $0.\n`);

  const toEscalate: { v: EscalationCandidate; reason: string; hhPage: string }[] = [];
  for (const v of candidates) {
    const verdict = await triageSite({ websiteUri: v.website_url!, name: v.name, cityName: city.name });
    const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: null, types: null, name: v.name }));
    if (decided.action !== "extract") continue;
    const built = await buildExtractRequest({
      venueName: v.name,
      websiteUrl: verdict.kind === "real" ? verdict.url : null,
      otherUrl: null,
      cityName: city.name,
      priorityUrls: decided.priorityUrls,
      noRender: true,
    });
    const free = freeExtractFromPages(built.pages, { model: "deterministic-html-v1", promptHash: built.promptHash });
    const esc = needsRenderEscalation({
      priorityUrls: decided.priorityUrls,
      readUrls: built.pages.map((p) => p.url),
      freeWindows: free ? free.happyHours.map((h) => ({ offerings: h.offerings })) : null,
    });
    if (esc.escalate) {
      toEscalate.push({ v, reason: esc.reason!, hhPage: esc.hhPages[0] ?? "?" });
      console.log(`  ⏫ ${v.name}: would escalate [${esc.reason}] (HH page: ${esc.hhPages[0] ?? "?"})`);
    }
  }

  const est = (toEscalate.length * ESCALATION_COST_EST_USD).toFixed(2);
  console.log(`\n${toEscalate.length} venue(s) would escalate. Est. paid cost: ~$${est} (~$${ESCALATION_COST_EST_USD}/venue).`);
  console.log(`Re-run with --preview to extract + write a review report (no DB write), or --apply to extract + apply.`);
  return toEscalate;
}
```

In `main()`, near the top after `const city = await resolveCity(...)`, route to escalation when `--escalate-paid` is set, BEFORE the existing free-fix logic:

```typescript
    if (ESCALATE && !APPLY_FROM) {
      await runEscalation(sql, city);
      return; // escalation owns this run; Tasks 3–4 add preview/apply branches here
    }
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: clean. (Remove the placeholder `_triageUnused` import if it duplicates an existing one — it's only a reminder.)

- [ ] **Step 3: Run the free dry-run on Oakland**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm audit:fix --city oakland --state ca --escalate-paid`
Expected: prints a list of `⏫` venues including `Oeste - Bar` (reason `unread_hh_page` or `hh_page_no_offerings`, HH page `…/happy-hour-menu`), then a count + `~$X` estimate. NO spend, NO writes. Confirm Oeste appears; paste the Oeste line into your report.

- [ ] **Step 4: Commit**

```bash
cd /Users/stevenmatthiesen/Personal/hhf-audit && git add scripts/audit-fix.ts && git commit -m "feat(audit): --escalate-paid free dry-run (detect unread HH pages + cost estimate)"
```

---

## Task 3: `--preview` — paid extract + review report (no DB write)

**Files:**
- Modify: `scripts/audit-fix.ts`

- [ ] **Step 1: Add the preview branch to `runEscalation`**

Replace the end of `runEscalation` (the `const est = …; console.log(...); return toEscalate;`) so that when `PREVIEW` (or `APPLY`) is set it runs the paid extraction and builds per-venue results. Add these imports at the top of the file if not present: `import { extractHappyHours } from "@/lib/ai/extractHappyHours";`, `import { closeRenderBrowser } from "@/lib/verification/renderUrl";`, `import { computeCorrection, type StoredRow, type CorrectedWindow } from "@/lib/audit/computeCorrection";`, `import { isHighConfidenceCorrection } from "@/lib/audit/anomalyRules";`, `import { mkdirSync, writeFileSync } from "node:fs";`.

Define a result type and the extraction helper:

```typescript
interface EscalationResult {
  venueId: string;
  name: string;
  hhPage: string;
  reason: string;
  storedActive: { days: number[]; start: string | null; end: string | null; offerings: number; src: string | null }[];
  found: { days: number[]; start: string | null; end: string | null; offerings: { name: string; price: number | null }[]; src: string | null }[];
  highConfidence: boolean;
  costCents: number;
  // raw for the apply cache:
  extracted: unknown; // ExtractResult
  deactivateIds: string[];
}

async function extractAndDiff(
  sql: postgres.Sql,
  cityId: string,
  cityName: string,
  c: { v: EscalationCandidate; reason: string; hhPage: string },
): Promise<EscalationResult> {
  const verdict = await triageSite({ websiteUri: c.v.website_url!, name: c.v.name, cityName });
  const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: null, types: null, name: c.v.name }));
  const extracted = await extractHappyHours({
    venueName: c.v.name,
    websiteUrl: verdict.kind === "real" ? verdict.url : null,
    otherUrl: null,
    cityName,
    priorityUrls: decided.priorityUrls,
  });
  const stored = await sql<StoredRow[]>`
    SELECT id, days_of_week AS "daysOfWeek", start_time AS "startTime", end_time AS "endTime",
           all_day AS "allDay", active, source_url AS "sourceUrl", notes
    FROM happy_hours WHERE venue_id = ${c.v.id} AND deleted_at IS NULL AND active = true`;
  const corrected: CorrectedWindow[] = extracted.happyHours
    .filter((h) => !h.suspect)
    .map((h) => ({ daysOfWeek: h.daysOfWeek, startTime: h.startTime, endTime: h.endTime, allDay: h.allDay, sourceUrl: h.sourceUrl, notes: h.notes }));
  const highConfidence = isHighConfidenceCorrection(corrected);
  const plan = computeCorrection(stored, corrected);
  const storedOfferingCounts = await sql<{ id: string; n: number }[]>`
    SELECT happy_hour_id AS id, count(*)::int AS n FROM offerings
    WHERE happy_hour_id = ANY(${stored.map((s) => s.id)}) AND active = true GROUP BY happy_hour_id`;
  const offCount = new Map(storedOfferingCounts.map((r) => [r.id, r.n]));
  return {
    venueId: c.v.id,
    name: c.v.name,
    hhPage: c.hhPage,
    reason: c.reason,
    storedActive: stored.map((s) => ({ days: s.daysOfWeek, start: s.startTime, end: s.endTime, offerings: offCount.get(s.id) ?? 0, src: s.sourceUrl })),
    found: extracted.happyHours.filter((h) => !h.suspect).map((h) => ({ days: h.daysOfWeek, start: h.startTime, end: h.endTime, offerings: h.offerings.map((o) => ({ name: o.name, price: o.priceCents })), src: h.sourceUrl })),
    highConfidence,
    costCents: extracted.costCents,
    extracted,
    deactivateIds: plan.deactivations,
  };
}
```

Then in `runEscalation`, after building `toEscalate`, add:

```typescript
  if (!PREVIEW && !APPLY) {
    const est = (toEscalate.length * ESCALATION_COST_EST_USD).toFixed(2);
    console.log(`\n${toEscalate.length} venue(s) would escalate. Est. paid cost: ~$${est}.`);
    console.log(`Re-run with --preview (report, no write) or --apply (apply).`);
    return;
  }

  const results: EscalationResult[] = [];
  try {
    for (const c of toEscalate) {
      const r = await extractAndDiff(sql, city.id, city.name, c);
      results.push(r);
      console.log(`  ⏫ ${r.name}: found ${r.found.length} window(s), ${r.found.reduce((a, w) => a + w.offerings.length, 0)} offering(s)${r.highConfidence ? "" : " [LOW-CONF → report]"} (${(r.costCents / 100).toFixed(3)}$)`);
    }
  } finally {
    await closeRenderBrowser();
  }

  // Write the review report + apply cache.
  mkdirSync("docs/audit-escalation", { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(`docs/audit-escalation/${city.slug}-${date}.json`, JSON.stringify(results, null, 2));
  const md: string[] = [`# Escalation review — ${city.name} (${date})`, "", `${results.length} venue(s) extracted. Total spend: $${(results.reduce((a, r) => a + r.costCents, 0) / 100).toFixed(2)}.`, ""];
  for (const r of results) {
    md.push(`## ${r.name}  [${r.reason}]  ${r.highConfidence ? "→ would apply" : "→ report only (low confidence)"}`);
    md.push(`HH page: ${r.hhPage}`);
    md.push(`**STORED (now):**`);
    for (const w of r.storedActive) md.push(`  - ${JSON.stringify(w.days)} ${w.start ?? "open"}–${w.end ?? "close"}  offerings:${w.offerings}  src=${w.src ?? "—"}`);
    md.push(`**FOUND (render+PDF):**`);
    for (const w of r.found) md.push(`  - ${JSON.stringify(w.days)} ${w.start ?? "open"}–${w.end ?? "close"}  offerings:${w.offerings.length} [${w.offerings.slice(0, 6).map((o) => o.name).join(", ")}]  src=${w.src ?? "—"}`);
    md.push(`**PROPOSED CHANGE:** insert ${r.found.length} window(s)+offerings; deactivate ${r.deactivateIds.length} prior window(s).`);
    md.push("");
  }
  writeFileSync(`docs/${city.slug}-escalation-review-${date}.md`, md.join("\n"));
  console.log(`\nReview report → docs/${city.slug}-escalation-review-${date}.md  (cache: docs/audit-escalation/${city.slug}-${date}.json)`);

  if (PREVIEW && !APPLY) {
    console.log(`PREVIEW only — NO DB writes. Review the report, then: pnpm audit:fix --city ${city.slug} --state <st> --escalate-paid --apply-from docs/audit-escalation/${city.slug}-${date}.json`);
    return;
  }
  // APPLY path is added in Task 4 (applyEscalationResults(results)).
  await applyEscalationResults(sql, city.id, results);
```

- [ ] **Step 2: Add a temporary stub for `applyEscalationResults` so it compiles**

Above `main`, add (Task 4 replaces the body):

```typescript
async function applyEscalationResults(_sql: postgres.Sql, _cityId: string, _results: EscalationResult[]): Promise<void> {
  throw new Error("applyEscalationResults not implemented yet (Task 4)");
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Preview a SINGLE venue (Oeste) to prove the report + no-write**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm audit:fix --city oakland --state ca --escalate-paid --preview --limit 1`
(`--limit 1` keeps spend to one venue. If Oeste isn't the first candidate alphabetically, temporarily also pass nothing else — or accept whichever single venue runs; the goal is to prove the flow. To force Oeste specifically, you may run the whole city preview, but that spends on all candidates — prefer `--limit` small.)
Expected: spends ~3–5¢, prints a FOUND line, writes `docs/oakland-escalation-review-<date>.md` + `docs/audit-escalation/oakland-<date>.json`, and prints "PREVIEW only — NO DB writes". Open the `.md` and confirm it shows STORED vs FOUND vs PROPOSED. Verify NO venue rows changed:
`cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL!); const r=await sql\`select count(*)::int n from happy_hours where created_at > now() - interval '2 minutes'\`; console.log('rows written in last 2 min:', r[0].n); await sql.end();"` → expect 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/stevenmatthiesen/Personal/hhf-audit && git add scripts/audit-fix.ts && git commit -m "feat(audit): --preview paid extract + STORED/FOUND/PROPOSED review report (no DB write)"
```

---

## Task 4: apply path — `--apply` and `--apply-from`

**Files:**
- Modify: `scripts/audit-fix.ts`

- [ ] **Step 1: Implement `applyEscalationResults`** (replace the Task 3 stub)

```typescript
import { persistExtractedWindows } from "@/lib/recover/resolveVenue";
import type { ExtractResult } from "@/lib/ai/extractHappyHours";

async function applyEscalationResults(
  sql: postgres.Sql,
  cityId: string,
  results: EscalationResult[],
): Promise<void> {
  let applied = 0, reported = 0;
  for (const r of results) {
    if (!r.highConfidence) {
      await sql`UPDATE data_audit SET resolution='reported' WHERE venue_id=${r.venueId}`;
      console.log(`  ⚑ ${r.name}: low confidence → report only`);
      reported++;
      continue;
    }
    try {
      await sql.begin(async (tx) => {
        // 1) Land the paid windows + offerings via the ONE audited persist path.
        await persistExtractedWindows({ venueId: r.venueId, cityId, extracted: r.extracted as ExtractResult, actor: "audit-escalate" });
        // 2) Soft-deactivate prior windows the new set supersedes (audit_log each).
        for (const id of r.deactivateIds) {
          const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${id}`;
          await tx`UPDATE happy_hours SET active=false, updated_at=now() WHERE id=${id}`;
          await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                   VALUES ('happy_hours', ${id}, ${tx.json(before as never)}, ${tx.json({ source_url: before.source_url, notes: before.notes, active: false } as never)}, 'audit-escalate', 'render-escalation: deactivate superseded window')`;
        }
        await tx`UPDATE data_audit SET resolution='fixed', fix_applied=true WHERE venue_id=${r.venueId}`;
      });
      console.log(`  ✓ ${r.name}: applied ${r.found.length} window(s)+offerings, deactivated ${r.deactivateIds.length} prior`);
      applied++;
    } catch (err) {
      console.error(`  ✗ ${r.name}: apply failed — ${(err as Error).message}`);
      reported++;
    }
  }
  console.log(`\nEscalation applied: ${applied}; reported: ${reported}.`);
}
```

NOTE: `persistExtractedWindows` uses `db` (drizzle), not the `tx` (postgres.js) — that's acceptable here (it runs its own statements + ledger). The `tx` block still atomically wraps the deactivations + resolution update. If a stricter single-transaction is wanted later, that's a follow-up; for now persist-then-deactivate is correct because persist only INSERTs (additive) and the deactivations are computed from the pre-persist stored set.

- [ ] **Step 2: Add the `--apply-from` branch in `main()`**

In `main()`, add (after the `ESCALATE && !APPLY_FROM` block from Task 2):

```typescript
    if (APPLY_FROM) {
      const { readFileSync } = await import("node:fs");
      const results = JSON.parse(readFileSync(APPLY_FROM, "utf8")) as EscalationResult[];
      console.log(`[apply-from] ${results.length} previewed result(s) from ${APPLY_FROM}. No re-extraction (spend already incurred).`);
      await applyEscalationResults(sql, city.id, results);
      return;
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/stevenmatthiesen/Personal/hhf-audit && git add scripts/audit-fix.ts && git commit -m "feat(audit): apply render-escalation results (persist windows+offerings, deactivate superseded, --apply-from)"
```

---

## Task 5: Wire CI + prove the full Oeste recovery end-to-end

**Files:**
- Modify: `package.json`, `scripts/ci-tests.sh`

- [ ] **Step 1: Add the detector test to CI**

In `package.json` `scripts` add: `"test:render-escalation": "tsx scripts/test-render-escalation.ts",`
In `scripts/ci-tests.sh` add `test:render-escalation` to the `TESTS=( … )` array (after `test:anomaly-rules`).

- [ ] **Step 2: Confirm the detector test is hermetic + suite green**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && env -u DATABASE_URL pnpm tsx scripts/test-render-escalation.ts` → PASS (pure).
Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && bash scripts/ci-tests.sh` → ends "✓ all N hermetic test suites passed."

- [ ] **Step 3: PROVE on Oeste — preview then apply-from**

```bash
# Targeted preview: capture Oeste's id to limit spend to exactly Oeste.
cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm audit:fix --city oakland --state ca --escalate-paid --preview --limit 1
```
If Oeste isn't the single previewed venue under `--limit 1`, run the full preview (spends on all candidates) OR temporarily filter the candidate query by Oeste's id for the proof. Read `docs/oakland-escalation-review-<date>.md` and confirm Oeste's FOUND block lists windows WITH offerings sourced from `/happy-hour-menu`.

Then apply the reviewed report (no re-spend):
```bash
cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm audit:fix --city oakland --state ca --escalate-paid --apply-from docs/audit-escalation/oakland-<date>.json
```

- [ ] **Step 4: Verify Oeste now has specials, prior windows deactivated, reversible**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL!); const w=await sql\`select h.start_time::text st,h.end_time::text et,h.active,h.source_url,(select count(*)::int from offerings o where o.happy_hour_id=h.id and o.active) offers from happy_hours h where h.venue_id='1f0f4933-0878-4600-bac4-77dedc05f34d' and h.deleted_at is null order by h.active desc\`; console.table(w); const a=await sql\`select count(*)::int n from audit_log where actor='audit-escalate'\`; console.log('audit-escalate log rows:', a[0].n); await sql.end();"`
Expected: ≥1 active window with `offers > 0` sourced from `…/happy-hour-menu`; the prior homepage windows `active=false`; `audit-escalate` log rows ≥ 1. If the live site is unreachable at run time, note it (the detector test in Step 2 still proves the logic).

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck
cd /Users/stevenmatthiesen/Personal/hhf-audit && git add package.json scripts/ci-tests.sh && git commit -m "test(audit): add test:render-escalation to CI; prove Oeste PDF-specials recovery"
```

---

## Spec coverage self-check

- **Uniform trigger (unread HH page), stubs ∪ flagged:** Task 1 detector + Task 2 candidate query. ✓
- **Free detection $0 / paid escalation only where needed:** Task 2 (free loop) → Task 3 (paid only for escalating venues). ✓
- **Cost-gated, opt-in, estimate first:** Task 2 prints est; `--escalate-paid` off by default; `--preview`/`--apply` required to spend. ✓
- **Review report (STORED vs FOUND vs PROPOSED) before any write:** Task 3 `--preview` writes md+json, no DB write. ✓
- **`--apply-from` (commit reviewed report, no re-spend):** Task 4. ✓
- **Reversible, one persist path + soft-deactivate + audit_log:** Task 4 `persistExtractedWindows` + deactivations. ✓
- **Windows + OFFERINGS land:** Task 4 via `persistExtractedWindows` (inserts offerings). ✓
- **Detector unit-tested in CI; Oeste proof gate:** Tasks 1 & 5. ✓

## Out of scope (per spec)

- Lifting the detector into `seed:enrich`/`reextract` free paths (phase 2).
- Discovery/ranking changes; render-service swaps; hard-deletes; auto-applying low-confidence.
