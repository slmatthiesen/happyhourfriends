# Trustworthy Contribution Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add/fix a venue's happy-hour data through one trust-aware pipeline — a self-authenticating first-party link can (eventually) auto-apply, while photos and free text are AI-structured and queued for the operator — without inaccurate data ever reaching the live site.

**Architecture:** One `intent` submission (note? + url? + photo?) per contribution. The interpret job becomes a router: a link whose host matches `venues.website` runs the seed-enrich **extractor**; everything else runs the **interpreter** (scope-lifted to create new windows) → classify → verify. A pure `routeContribution` function makes the auto-apply-vs-queue decision, gated behind a flag that is **off** at launch (everything queues for review). A SafeSearch gate rejects inappropriate photos at upload and evidence is quarantined until it passes.

**Tech Stack:** Next.js 16 (App Router) · TypeScript strict · Drizzle ORM + postgres.js · pg-boss · Anthropic SDK · sharp · Google Cloud Vision SafeSearch. Tests use `tsx` + `node:assert/strict` runnable scripts (no jest/vitest in repo); UI/integration verified via `npm run typecheck`, `npm run build`, and a script driver against the dev DB.

**Rollout:** M1 (Tasks 1–9) is independently shippable and dogfoodable with the auto-apply flag OFF. M2 (Tasks 10–12) adds the moderation gate + quarantine and should land before any public exposure.

---

## File Structure

**New files**
- `lib/contribution/firstParty.ts` — `isFirstPartyUrl(submittedUrl, venueWebsite)` pure helper.
- `lib/contribution/route.ts` — `routeContribution(input)` pure decision + `isAutoApplyEnabled()` flag reader.
- `lib/moderation/safeSearch.ts` — `moderateImage(base64, mime)` SafeSearch client (M2).
- `components/submit/contribute.tsx` — the single unified contribution box.
- `scripts/test-first-party.ts`, `scripts/test-route-contribution.ts`, `scripts/test-interpreter-newhh.ts`, `scripts/test-safesearch.ts` — runnable unit checks.

**Modified files**
- `lib/ai/interpreter.ts` — add `new_happy_hour` action to the schema + actions.
- `prompts/interpret-submission.md` — lift "no new windows" restriction; bump version.
- `lib/jobs/handlers/interpret.ts` — router (first-party → extractor mapping; `resolveOp` handles `new_happy_hour`).
- `lib/jobs/handlers/classify.ts` / `verify.ts` — replace the hard "children never auto-apply" gate with `routeContribution`.
- `app/[city]/venue/[slug]/page.tsx` — render `Contribute`; remove the `AddHappyHour` + `ReportChange` redundancy.
- `lib/admin/auth.ts` — dev-only local admin login.
- `components/admin/submission-card.tsx` — render the structured suggestion + source + confidence.
- `lib/submit/evidenceStore.ts` — quarantine storage + moderation hook (M2).
- `app/api/submissions/route.ts` — moderation reject + "at least one of note/url/photo" (M2 + M1 validation).
- `.env.example` — document `CONTRIBUTION_AUTOAPPLY`, `DEV_ADMIN_EMAIL`, `GOOGLE_VISION_API_KEY`, `EVIDENCE_QUARANTINE_DIR`.

---

# Milestone 1 — Dogfoodable contribution pipeline (auto-apply OFF)

## Task 1: First-party URL match helper

**Files:**
- Create: `lib/contribution/firstParty.ts`
- Test: `scripts/test-first-party.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-first-party.ts
/**
 * Runnable unit checks for first-party URL matching (no test framework in repo).
 * Run: npx tsx scripts/test-first-party.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { isFirstPartyUrl } from "@/lib/contribution/firstParty";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("exact host matches", () =>
  assert.equal(isFirstPartyUrl("https://eatdoughbird.com/menu", "https://eatdoughbird.com"), true));
check("www vs bare matches", () =>
  assert.equal(isFirstPartyUrl("https://www.eatdoughbird.com/x", "https://eatdoughbird.com"), true));
check("subdomain of site matches", () =>
  assert.equal(isFirstPartyUrl("https://menu.eatdoughbird.com/hh", "https://eatdoughbird.com"), true));
check("case-insensitive", () =>
  assert.equal(isFirstPartyUrl("https://EatDoughbird.com", "https://eatdoughbird.com"), true));
check("different domain is not first-party", () =>
  assert.equal(isFirstPartyUrl("https://yelp.com/biz/doughbird", "https://eatdoughbird.com"), false));
check("denylisted aggregator never first-party", () =>
  assert.equal(isFirstPartyUrl("https://ultimatehappyhours.com/x", "https://ultimatehappyhours.com"), false));
check("no stored website -> not first-party", () =>
  assert.equal(isFirstPartyUrl("https://eatdoughbird.com", null), false));
check("no submitted url -> not first-party", () =>
  assert.equal(isFirstPartyUrl(null, "https://eatdoughbird.com"), false));
check("unparseable url -> not first-party", () =>
  assert.equal(isFirstPartyUrl("not a url", "https://eatdoughbird.com"), false));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-first-party.ts`
Expected: FAIL — `Cannot find module '@/lib/contribution/firstParty'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/contribution/firstParty.ts
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";

/** Lowercase host with a leading "www." stripped; null if unparseable. */
function normHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * True when `submittedUrl` is on the venue's OWN website (`venueWebsite`) — the
 * self-authenticating signal that lets a contribution be trusted to auto-apply.
 * A subdomain of the site counts (menu.x.com vs x.com). A known aggregator never
 * counts, even if the domains line up. No stored website → not first-party.
 */
export function isFirstPartyUrl(
  submittedUrl: string | null | undefined,
  venueWebsite: string | null | undefined,
): boolean {
  const sub = normHost(submittedUrl);
  const site = normHost(venueWebsite);
  if (!sub || !site) return false;
  if (submittedUrl && isDenylistedSource(submittedUrl)) return false;
  return sub === site || sub.endsWith(`.${site}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-first-party.ts`
Expected: PASS — `9 checks passed.`

- [ ] **Step 5: Add npm script + commit**

Add to `package.json` scripts (alphabetical-ish with the other `test:*`):
```json
"test:first-party": "tsx scripts/test-first-party.ts",
```

```bash
git add lib/contribution/firstParty.ts scripts/test-first-party.ts package.json
git commit -m "feat(contribution): first-party URL match helper"
```

---

## Task 2: Trust-matrix router + auto-apply flag

**Files:**
- Create: `lib/contribution/route.ts`
- Test: `scripts/test-route-contribution.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-route-contribution.ts
/**
 * Runnable truth-table checks for routeContribution — the load-bearing safety
 * decision. Run: npx tsx scripts/test-route-contribution.ts
 */
import assert from "node:assert/strict";
import { routeContribution, type ContributionRouteInput } from "@/lib/contribution/route";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const base: ContributionRouteInput = {
  firstParty: true,
  confidence: 0.95,
  submitterBanned: false,
  submitterTrustScore: 0,
  critical: false,
  autoApplyEnabled: true,
};

check("the one safe row auto-applies", () =>
  assert.equal(routeContribution(base), "auto_apply"));
check("flag off -> queue", () =>
  assert.equal(routeContribution({ ...base, autoApplyEnabled: false }), "queue"));
check("not first-party -> queue", () =>
  assert.equal(routeContribution({ ...base, firstParty: false }), "queue"));
check("low confidence -> queue", () =>
  assert.equal(routeContribution({ ...base, confidence: 0.5 }), "queue"));
check("banned submitter -> queue", () =>
  assert.equal(routeContribution({ ...base, submitterBanned: true }), "queue"));
check("negative trust -> queue", () =>
  assert.equal(routeContribution({ ...base, submitterTrustScore: -1 }), "queue"));
check("critical change never auto-applies", () =>
  assert.equal(routeContribution({ ...base, critical: true }), "queue"));
check("confidence exactly at threshold auto-applies", () =>
  assert.equal(routeContribution({ ...base, confidence: 0.85 }), "auto_apply"));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-route-contribution.ts`
Expected: FAIL — `Cannot find module '@/lib/contribution/route'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/contribution/route.ts

/** Minimum extractor/verifier confidence to auto-apply a first-party contribution. */
export const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.85;

export interface ContributionRouteInput {
  /** Submitted URL is on the venue's own website (see isFirstPartyUrl). */
  firstParty: boolean;
  /** Extractor/verifier confidence 0..1. */
  confidence: number;
  submitterBanned: boolean;
  /** submitter_trust.trust_score; must be >= 0 (good standing) to auto-apply. */
  submitterTrustScore: number;
  /** venue closed / no_happy_hour — never auto-applies. */
  critical: boolean;
  /** CONTRIBUTION_AUTOAPPLY flag (see isAutoApplyEnabled). */
  autoApplyEnabled: boolean;
}

/**
 * The single auto-apply-vs-queue decision. Auto-apply ONLY when ALL hold:
 * flag on, first-party source, high confidence, non-critical change, and a
 * good-standing submitter. Everything else is queued for the operator.
 */
export function routeContribution(i: ContributionRouteInput): "auto_apply" | "queue" {
  const ok =
    i.autoApplyEnabled &&
    i.firstParty &&
    !i.critical &&
    !i.submitterBanned &&
    i.submitterTrustScore >= 0 &&
    i.confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD;
  return ok ? "auto_apply" : "queue";
}

/** Reads the launch flag. Default OFF — everything queues until explicitly enabled. */
export function isAutoApplyEnabled(): boolean {
  const v = (process.env.CONTRIBUTION_AUTOAPPLY ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-route-contribution.ts`
Expected: PASS — `8 checks passed.`

- [ ] **Step 5: Add npm script + commit**

Add to `package.json` scripts:
```json
"test:route-contribution": "tsx scripts/test-route-contribution.ts",
```

```bash
git add lib/contribution/route.ts scripts/test-route-contribution.ts package.json
git commit -m "feat(contribution): trust-matrix router + auto-apply flag (default off)"
```

---

## Task 3: Lift the interpreter to propose new happy-hour windows

**Files:**
- Modify: `lib/ai/interpreter.ts` (INTERPRET_ACTIONS line ~42, RECORD_TOOL schema lines ~108-172)
- Modify: `prompts/interpret-submission.md` (frontmatter version line ~3; HARD RULES lines ~20-22; Action guide ~lines 35-58)
- Test: `scripts/test-interpreter-newhh.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-interpreter-newhh.ts
/**
 * Checks that normaliseOp accepts the new `new_happy_hour` action and passes its
 * after blob through. Run: npx tsx scripts/test-interpreter-newhh.ts
 */
import assert from "node:assert/strict";
import { normaliseOp, INTERPRET_ACTIONS } from "@/lib/ai/interpreter";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("new_happy_hour is an allowed action", () =>
  assert.ok((INTERPRET_ACTIONS as readonly string[]).includes("new_happy_hour")));

check("normaliseOp keeps a new_happy_hour op with days+start+offerings", () => {
  const op = normaliseOp({
    action: "new_happy_hour",
    targetId: null,
    after: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "15:00",
      endTime: "18:00",
      offerings: [{ kind: "drink", category: "beer", name: "Drafts", priceCents: 400 }],
    },
    summary: "Add weekday 3-6 happy hour",
    confidence: 0.9,
  });
  assert.ok(op);
  assert.equal(op!.action, "new_happy_hour");
  assert.deepEqual((op!.after as Record<string, unknown>).daysOfWeek, [1, 2, 3, 4, 5]);
});

check("an unknown action is still dropped", () =>
  assert.equal(normaliseOp({ action: "delete_everything", after: {}, summary: "", confidence: 1 }), null));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-interpreter-newhh.ts`
Expected: FAIL — first check fails (`new_happy_hour` not in `INTERPRET_ACTIONS`).

- [ ] **Step 3: Edit `lib/ai/interpreter.ts` — add the action**

Change the actions tuple (line ~42):
```typescript
export const INTERPRET_ACTIONS = [
  "update_venue",
  "update_happy_hour",
  "update_offering",
  "new_offering",
  "new_happy_hour",
] as const;
```

In `RECORD_TOOL`, update the `changes` array description (line ~119):
```typescript
        description: `At most ${MAX_OPS} changes. Modify existing data, add an offering to an existing happy hour, or add a NEW happy-hour window (new_happy_hour) when the venue has none for the days/time reported.`,
```

Update the `action` enum description (lines ~126-131) to add the new action:
```typescript
              description:
                "update_venue (name/address/phone/websiteUrl/otherUrl/status/type), " +
                "update_happy_hour (startTime/endTime/notes/active/daysOfWeek), " +
                "update_offering (name/priceCents/discountCents/etc), " +
                "new_offering (a new deal on an existing happy hour), " +
                "new_happy_hour (a brand-new window: after MUST include daysOfWeek (ISO ints) and startTime 'HH:MM'; may include endTime/notes/offerings[]).",
```

Update the `after` description (lines ~146-153) — append the new-window requirement:
```typescript
              description:
                "Only the columns that change, with their new values. Prices are integer " +
                "cents (e.g. $3 → 300). venue status is one of active/closed/paused/no_happy_hour. " +
                "venue type must be one of: " + VENUE_TYPES.join(", ") + ". " +
                "times are 24h 'HH:MM' or null for 'until close'. For new_offering include at " +
                "least kind (food/drink/other) and category (beer/wine/cocktail/spirit/appetizer/entree/dessert/other). " +
                "For new_happy_hour include daysOfWeek (ISO int array) and a startTime 'HH:MM', plus offerings[] when known.",
```

- [ ] **Step 4: Edit `prompts/interpret-submission.md` — lift the restriction**

Bump the version in frontmatter (line ~3): `version: 2` and update `notes:` to mention new-window support.

Replace the HARD RULES bullet (lines ~20-22):
```markdown
- Modify existing data, ADD an offering to an EXISTING happy hour, or ADD a NEW
  happy-hour window when the venue has no window covering the reported days/time.
  You may NOT create a new venue. For a new window use `new_happy_hour`; if the report
  implies a wholesale menu replacement, set `tooLarge: true` and `changes: []`.
```

Add a bullet to the Action guide (after the `new_offering` entry, ~line 58):
```markdown
- `new_happy_hour` — a brand-new window the venue doesn't have yet (e.g. a stub with no
  happy hour, or "they now also do Sunday 4-6"). `targetId` is `null`. `after` MUST
  include `daysOfWeek` (ISO int array) and `startTime` ("HH:MM"); include `endTime`
  (or `null` for "until close"), `notes`, and `offerings` (each with `kind` + `category`)
  when stated. Never fabricate times or prices the report/photo doesn't show.
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx tsx scripts/test-interpreter-newhh.ts`
Expected: PASS — `3 checks passed.`
Run: `npm run typecheck`
Expected: no new errors (the 2 pre-existing Phase 0 issues may remain).

- [ ] **Step 6: Add npm script + commit**

Add to `package.json`:
```json
"test:interpreter-newhh": "tsx scripts/test-interpreter-newhh.ts",
```

```bash
git add lib/ai/interpreter.ts prompts/interpret-submission.md scripts/test-interpreter-newhh.ts package.json
git commit -m "feat(interpreter): allow new_happy_hour windows (scope lift, prompt v2)"
```

---

## Task 4: Interpret handler — first-party router + new_happy_hour fan-out

**Files:**
- Modify: `lib/jobs/handlers/interpret.ts` (`resolveOp` helper ~lines 39-95; `handleInterpret` ~lines 105-221)

This task wires the router. Read `resolveOp` and `handleInterpret` in full before editing — both are in this one file.

- [ ] **Step 1: Add a `new_happy_hour` case to `resolveOp`**

`resolveOp(op, venue)` maps an `InterpretedOp` to `{ targetType, targetId, before, after }` or `null`. Add a branch for the new action. Insert alongside the existing `new_offering` branch:

```typescript
  if (op.action === "new_happy_hour") {
    const after = op.after as Record<string, unknown>;
    const days = after.daysOfWeek;
    // Require the engine's minimum (venueId + days + startTime) or the child can't apply.
    if (!Array.isArray(days) || days.length === 0 || typeof after.startTime !== "string") {
      return null;
    }
    return {
      targetType: "new_happy_hour",
      targetId: venue.id,
      before: null,
      after: { ...after, venueId: venue.id },
    };
  }
```

- [ ] **Step 2: Add first-party detection + the extractor branch in `handleInterpret`**

At the top of `handleInterpret`, after `const parentSourceUrl = diff.sourceUrl ?? null;` (~line 132), add the imports and the branch. New imports at the top of the file:
```typescript
import { isFirstPartyUrl } from "@/lib/contribution/firstParty";
import { extractHappyHours } from "@/lib/ai/extractHappyHours";
```

Replace the single `result = await interpret(...)` flow with a branch that runs the extractor for first-party URLs and otherwise interprets. Insert before the existing `let result; try { result = await interpret(...) }` block:

```typescript
  const firstParty = isFirstPartyUrl(parentSourceUrl, venue.websiteUrl);

  // First-party URL: read the venue's own page with the proven extractor and fan out
  // new_happy_hour children directly. These skip classify/verify (authoritative source).
  if (firstParty && parentSourceUrl) {
    let extracted;
    try {
      extracted = await extractHappyHours({
        venueName: venue.name,
        websiteUrl: venue.websiteUrl,
        priorityUrls: [parentSourceUrl],
      });
    } catch (e) {
      await setStatus(submissionId, {
        status: "queued_admin",
        aiClassifierReasoning: `First-party extract failed: ${errMsg(e)}`,
      });
      return;
    }
    await recordUsage({
      stage: "interpret",
      model: extracted.model,
      usage: extracted.usage,
      costCents: extracted.costCents,
      promptHash: extracted.promptHash,
      submissionId,
      cityId: venue.cityId,
    });
    await fanOutExtracted(parent, venue, extracted, parentSourceUrl);
    await setStatus(submissionId, {
      status: "interpreted",
      aiClassifierReasoning: `Extracted ${extracted.happyHours.length} window(s) from first-party source.`,
      decidedAt: new Date(),
    });
    return;
  }
```

- [ ] **Step 3: Add the `fanOutExtracted` helper to the same file**

```typescript
import { applySubmission } from "@/lib/apply/engine";
import { routeContribution, isAutoApplyEnabled } from "@/lib/contribution/route";

/**
 * Turn extractor output into new_happy_hour child submissions. Each child carries the
 * first-party URL as its source. The router decides auto-apply vs queue; with the flag
 * OFF (launch) every child is queued for the operator.
 */
async function fanOutExtracted(
  parent: typeof editSubmissions.$inferSelect,
  venue: VenueDetail,
  extracted: Awaited<ReturnType<typeof extractHappyHours>>,
  sourceUrl: string,
): Promise<void> {
  const autoApplyEnabled = isAutoApplyEnabled();
  for (const hh of extracted.happyHours) {
    if (!hh.daysOfWeek?.length || !hh.startTime) continue; // engine minimum
    const [child] = await db
      .insert(editSubmissions)
      .values({
        targetType: "new_happy_hour",
        targetId: venue.id,
        parentSubmissionId: parent.id,
        diffJsonb: {
          before: null,
          after: {
            venueId: venue.id,
            daysOfWeek: hh.daysOfWeek,
            startTime: hh.startTime,
            endTime: hh.endTime,
            notes: hh.notes,
            offerings: hh.offerings,
          },
          sourceUrl,
          summary: `Add happy hour (${hh.daysOfWeek.join(",")} from ${hh.startTime})`,
        },
        submitterFingerprint: parent.submitterFingerprint,
        submitterIp: parent.submitterIp,
        submitterEmail: parent.submitterEmail,
        status: "pending",
      })
      .returning();
    const decision = routeContribution({
      firstParty: true,
      confidence: extracted.confidence,
      submitterBanned: false,
      submitterTrustScore: 0,
      critical: false,
      autoApplyEnabled,
    });
    if (decision === "auto_apply") {
      try {
        await applySubmission(child.id, { actor: "ai", reason: "First-party extract, high confidence." });
        continue;
      } catch {
        /* fall through to queue */
      }
    }
    await setStatus(child.id, { status: "queued_admin" });
  }
}
```

NOTE: `VenueDetail` is already imported in this file (used by `getVenueDetailById`); if not, add `import type { VenueDetail } from "@/lib/queries/venues";`.

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck`
Expected: no new errors. Fix any type mismatch (e.g. `venue.websiteUrl` — confirm the field name on `VenueDetail`; the venue page uses `venue.websiteUrl`).

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/interpret.ts
git commit -m "feat(interpret): first-party URL -> extractor fan-out of new_happy_hour children"
```

---

## Task 5: Route classify/verify children through routeContribution

**Files:**
- Modify: `lib/jobs/handlers/classify.ts` (the `if (sub.parentSubmissionId != null)` block ~lines 123-138)
- Modify: `lib/jobs/handlers/verify.ts` (the `if (sub.parentSubmissionId != null)` block ~lines 282-290)

With the flag OFF this is behaviour-preserving (children still queue). It replaces the *hard* "never auto-apply" gate with the trust-matrix decision so M2/Phase-2 can flip the flag without touching handlers.

- [ ] **Step 1: classify.ts — keep children going to verify (unchanged routing, documented)**

The classify child gate stays as-is (children still go to verify so the operator gets a confidence read), EXCEPT we leave the auto-apply decision to verify. No code change needed in classify beyond a clarifying comment. Confirm the block reads:

```typescript
  if (sub.parentSubmissionId != null) {
    if (banned) {
      await setStatus(submissionId, { status: "queued_admin" });
      return;
    }
    await setStatus(submissionId, { status: "verifying" });
    try {
      await enqueueVerify(submissionId);
    } catch (e) {
      await setStatus(submissionId, {
        status: "queued_admin",
        aiClassifierReasoning: `${result.reasoning} (verify enqueue failed: ${errMsg(e)})`,
      });
    }
    return;
  }
```

(No change — children still always verify. The decision moves to Step 2.)

- [ ] **Step 2: verify.ts — replace the child gate with routeContribution**

Add imports at the top of `lib/jobs/handlers/verify.ts`:
```typescript
import { routeContribution, isAutoApplyEnabled } from "@/lib/contribution/route";
import { isFirstPartyUrl } from "@/lib/contribution/firstParty";
```

Replace the child block (~lines 282-290):
```typescript
  if (sub.parentSubmissionId != null) {
    const verdict = verdictFor(result.confirmed);
    const supportingUrl = result.evidence.find((e) => e.supportsChange)?.url;
    const firstParty = isFirstPartyUrl(diff.sourceUrl, ctx.websiteUrl);
    const critical =
      sub.targetType === "venue" &&
      typeof (diff.after as Record<string, unknown>)?.status === "string" &&
      ["closed", "no_happy_hour"].includes((diff.after as Record<string, string>).status);
    const decision = routeContribution({
      firstParty,
      confidence: result.confidence,
      submitterBanned: false,
      submitterTrustScore: 0,
      critical,
      autoApplyEnabled: isAutoApplyEnabled(),
    });
    if (decision === "auto_apply" && result.confirmed !== false) {
      try {
        await autoApply(sub, diff, supportingUrl, result.summary);
        return;
      } catch {
        /* fall through to queue + notify */
      }
    }
    await setStatus(submissionId, {
      status: "queued_admin",
      aiClassifierReasoning: `AI ${verdict} (confidence ${result.confidence.toFixed(2)}): ${result.summary}`,
    });
    await notifyOperator(sub, ctx.name, diff, result);
    return;
  }
```

NOTE: confirm `ctx.websiteUrl` is available on the `venueContext` return (the agent report shows `ctx.websiteUrl` used to build `VerifyInput`). `autoApply` is the existing helper (lines ~113-130).

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/jobs/handlers/verify.ts lib/jobs/handlers/classify.ts
git commit -m "feat(verify): route interpreted children via trust-matrix (auto-apply gated by flag)"
```

---

## Task 6: Unified `Contribute` component

**Files:**
- Create: `components/submit/contribute.tsx`

Model it on `components/submit/report-change.tsx` (the existing `intent` poster). It adds adaptive copy + a required "at least one of note/url/photo" rule.

- [ ] **Step 1: Write the component**

```tsx
// components/submit/contribute.tsx
"use client";

import { useState } from "react";
import { getFingerprint } from "./submission-form";
import { HCaptcha } from "./hcaptcha"; // confirm the existing import path used by report-change.tsx
import type { SubmissionPayload } from "@/lib/submit/payload";

export function Contribute({
  venueId,
  venueName,
  hasHappyHour,
}: {
  venueId: string;
  venueName: string;
  hasHappyHour: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const heading = hasHappyHour ? "Something off? Tell us" : `Know ${venueName}'s happy hour? Add it`;
  const blurb = hasHappyHour
    ? "Prices changed? New deal? Closed? Just tell us in plain words — or paste a link / snap the menu. Our AI sorts out the details and a human approves before anything goes live."
    : "Paste a link to their happy-hour page or snap a photo of the menu, and add whatever details you know. A human reviews everything before it goes live.";

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function onSubmit() {
    const trimmed = note.trim();
    const url = sourceUrl.trim();
    // At least one of note (>=10 chars) / url / photo.
    if (trimmed.length < 10 && !url && !imageDataUrl) {
      setError("Tell us what's happening (a sentence), or add a link or photo.");
      setState("error");
      return;
    }
    const payload: SubmissionPayload = {
      targetType: "intent",
      targetId: venueId,
      diff: {
        before: null,
        after: { note: trimmed },
        sourceUrl: url || null,
        summary: (trimmed || `Contribution for ${venueName}`).slice(0, 120),
      },
      fingerprint: getFingerprint(),
      email: email.trim() || null,
      captchaToken: token,
      evidenceImage: imageDataUrl,
      website,
    };
    setState("submitting");
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; statusUrl?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setState("error");
        return;
      }
      setStatusUrl(data.statusUrl ?? null);
      setState("done");
    } catch {
      setError("Network error — please try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-lg border border-border bg-bg-surface p-4 text-sm text-text-muted">
        Thanks — your update is in the review queue.{" "}
        {statusUrl && (
          <a className="text-accent-cool hover:underline" href={statusUrl}>
            Track its status ↗
          </a>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent-warm px-3 py-1.5 text-sm font-medium text-bg-deep hover:opacity-90"
      >
        {hasHappyHour ? "Suggest a change" : "Add a happy hour"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-surface p-4">
      <h3 className="text-lg text-text-primary" style={{ fontFamily: "var(--font-serif)" }}>
        {heading}
      </h3>
      <p className="mt-1 mb-3 text-sm text-text-muted">{blurb}</p>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Happy hour is 3–6 Mon–Fri, $5 drafts and half-price apps · They added $6 wings · This place closed"
        className="w-full rounded border border-border bg-bg-elevated px-3 py-2 text-sm"
        rows={3}
      />
      <input
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        placeholder="Link to their happy-hour page (optional)"
        className="mt-2 w-full rounded border border-border bg-bg-elevated px-3 py-2 text-sm"
      />
      <input type="file" accept="image/*,application/pdf" onChange={onPickImage} className="mt-2 block text-sm" />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email (optional, for follow-up)"
        className="mt-2 w-full rounded border border-border bg-bg-elevated px-3 py-2 text-sm"
      />
      {/* honeypot */}
      <input
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <div className="mt-3">
        <HCaptcha onToken={setToken} />
      </div>
      {error && <p className="mt-2 text-sm text-accent-hot">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={state === "submitting"}
          onClick={onSubmit}
          className="rounded-md bg-accent-warm px-3 py-1.5 text-sm font-medium text-bg-deep hover:opacity-90 disabled:opacity-50"
        >
          {state === "submitting" ? "Submitting…" : "Submit"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-row-hover"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Reconcile imports with the real `report-change.tsx`**

Open `components/submit/report-change.tsx` and copy its EXACT import lines for `HCaptcha` and the image-picker helper (the snippet above guesses `./hcaptcha`). Match the real paths/props so this compiles.

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/submit/contribute.tsx
git commit -m "feat(submit): unified Contribute box (adaptive copy, note/url/photo)"
```

---

## Task 7: Wire `Contribute` into the venue page; remove the redundancy

**Files:**
- Modify: `app/[city]/venue/[slug]/page.tsx` (imports ~lines 6-7; stub block ~lines 302-316; bottom section ~lines 375-388)

- [ ] **Step 1: Swap the imports**

Replace lines 6-7:
```typescript
import { Contribute } from "@/components/submit/contribute";
```
(Delete the `AddHappyHour` and `ReportChange` imports.)

- [ ] **Step 2: Replace the stub empty-state block (lines 302-316)**

```tsx
        {activeHours.length === 0 ? (
          <div id="add-happy-hour" className="mt-4 rounded-lg border border-border bg-bg-surface p-6">
            <p className="text-text-muted">
              We don&apos;t have confirmed happy hour info for {venue.name} yet.
            </p>
            <div className="mt-4">
              <Contribute venueId={venue.id} venueName={venue.name} hasHappyHour={false} />
            </div>
          </div>
        ) : (
```

- [ ] **Step 3: Replace the bottom "Keep this listing accurate" section (lines 375-388)**

On a populated venue this stays; on a stub it's now redundant with the block above, so render it ONLY when there are active hours:
```tsx
      {activeHours.length > 0 && (
        <section className="mt-12 border-t border-border pt-8">
          <h2 className="text-xl text-text-primary" style={{ fontFamily: "var(--font-serif)" }}>
            Keep this listing accurate
          </h2>
          <p className="mt-1 mb-3 text-sm text-text-muted">
            Prices changed? New deal? Closed? Just tell us in plain words — our AI sorts out
            the details and a human approves it before anything goes live.
          </p>
          <Contribute venueId={venue.id} venueName={venue.name} hasHappyHour={true} />
        </section>
      )}
```

- [ ] **Step 4: Verify build**

Run: `npm run typecheck && npm run build`
Expected: compiles. (The old `add-happy-hour.tsx` / `report-change.tsx` become unused — leave them in place for now; a later cleanup commit can delete them once nothing imports them.)

- [ ] **Step 5: Commit**

```bash
git add app/[city]/venue/[slug]/page.tsx
git commit -m "feat(venue): single Contribute box; drop the two-affordance redundancy"
```

---

## Task 8: Dev-only local admin login

**Files:**
- Modify: `lib/admin/auth.ts` (`getAdmin()` — the session reader behind `requireAdmin`)

Lets the operator reach `/admin` locally without Firebase. Gated to non-production + an explicit env so it can never accidentally open prod.

- [ ] **Step 1: Add the dev bypass to `getAdmin()`**

Read `getAdmin()` in `lib/admin/auth.ts`, then add at the very top of the function body:
```typescript
  // Dev-only local admin: never in production, only when DEV_ADMIN_EMAIL is set.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_ADMIN_EMAIL) {
    return { uid: "dev-local", email: process.env.DEV_ADMIN_EMAIL.toLowerCase() };
  }
```

- [ ] **Step 2: Document the env**

Add to `.env.example`:
```
# Dev-only: bypass Firebase admin auth on localhost. NEVER set in production.
DEV_ADMIN_EMAIL=
```

- [ ] **Step 3: Verify**

Set `DEV_ADMIN_EMAIL=steven.matthiesen@gmail.com` in `.env`, run `npm run dev`, open `/admin`.
Expected: the queue renders (no sign-in wall). Run `npm run typecheck` — no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/admin/auth.ts .env.example
git commit -m "feat(admin): dev-only local login (non-prod, DEV_ADMIN_EMAIL)"
```

---

## Task 9: Admin card — show the structured suggestion, source, and confidence

**Files:**
- Modify: `components/admin/submission-card.tsx` (the diff table + add a source/confidence header)
- Modify: `app/admin/page.tsx` (pass `aiReasoning`/confidence + source through to the card if not already)

- [ ] **Step 1: Render the source + AI confidence above the diff table**

In `SubmissionCard`, add above the diff `<table>`:
```tsx
      {item.diff.sourceUrl && (
        <p className="mt-2 text-sm">
          {/uploads\//.test(item.diff.sourceUrl) ? (
            <a className="text-accent-cool hover:underline" href={item.diff.sourceUrl} target="_blank" rel="noopener noreferrer">
              View submitted photo ↗
            </a>
          ) : (
            <a className="text-accent-cool hover:underline" href={item.diff.sourceUrl} target="_blank" rel="noopener noreferrer">
              Source: {item.diff.sourceUrl} ↗
            </a>
          )}
        </p>
      )}
      {item.aiReasoning && (
        <p className="mt-1 text-sm text-text-muted">AI: {item.aiReasoning}</p>
      )}
```

(The existing before/after table already renders `daysOfWeek`/`startTime`/`offerings` keys from `diff.after`, so an extracted new_happy_hour suggestion shows up as proposed fields with no extra work.)

- [ ] **Step 2: Confirm `aiReasoning` reaches the card**

In `app/admin/page.tsx`, where the row is mapped to `QueueItem`, ensure `aiReasoning: row.aiClassifierReasoning` and `sourceUrl` are included. Add them if missing.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: compiles. Manually: with a queued submission, the card shows the source link/photo + the AI reasoning + the proposed fields.

- [ ] **Step 4: Commit**

```bash
git add components/admin/submission-card.tsx app/admin/page.tsx
git commit -m "feat(admin): show source, AI confidence, and structured suggestion on cards"
```

---

## Task 10 (M1 close-out): End-to-end script driver + manual dogfood check

**Files:**
- Create: `scripts/test-contribution-pipeline.ts`

Exercises the real handlers against the dev DB for the three routing cases. Requires `DATABASE_URL` and `ANTHROPIC_API_KEY`.

- [ ] **Step 1: Write the driver**

```typescript
// scripts/test-contribution-pipeline.ts
/**
 * Drives the contribution pipeline against the dev DB for three cases. Inserts an
 * `intent` submission, runs the interpret handler in-process, and prints the children
 * + their statuses. Run: npx tsx scripts/test-contribution-pipeline.ts <venueId> <case>
 *   case = firstparty | photo | text
 */
import { db } from "@/db/client";
import { editSubmissions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { handleInterpret } from "@/lib/jobs/handlers/interpret";

async function main() {
  const [venueId, kase] = process.argv.slice(2);
  if (!venueId) throw new Error("usage: tsx scripts/test-contribution-pipeline.ts <venueId> <firstparty|photo|text>");

  const after = { note: kase === "text" ? "Happy hour is now 3-6 Mon-Fri, $5 drafts" : "See menu" };
  const sourceUrl = kase === "firstparty" ? "PUT_A_FIRST_PARTY_URL_HERE" : null;

  const [row] = await db
    .insert(editSubmissions)
    .values({
      targetType: "intent",
      targetId: venueId,
      diffJsonb: { before: null, after, sourceUrl, summary: "driver test" },
      submitterFingerprint: "driver-test",
      status: "pending",
    })
    .returning();
  console.log("parent:", row.id);

  await handleInterpret(row.id);

  const kids = await db.select().from(editSubmissions).where(eq(editSubmissions.parentSubmissionId, row.id));
  console.log(`children: ${kids.length}`);
  for (const k of kids) console.log(`  - ${k.targetType} status=${k.status} after=${JSON.stringify((k.diffJsonb as any).after)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the three cases**

Pick a populated Phoenix venue id (e.g. Taco Guild) for `text`, and the Doughbird id (`5fcbffcd-01ca-41cf-8b19-25a4848df82f`) with its real `eatdoughbird.com` HH URL for `firstparty`.

Run:
```bash
npx tsx scripts/test-contribution-pipeline.ts <tacoGuildId> text
npx tsx scripts/test-contribution-pipeline.ts 5fcbffcd-01ca-41cf-8b19-25a4848df82f firstparty
```
Expected: `text` fans out update/new children in `verifying`/`queued_admin`; `firstparty` fans out `new_happy_hour` children in `queued_admin` (flag off). Confirm none auto-apply.

- [ ] **Step 3: Manual dogfood gate**

With `DEV_ADMIN_EMAIL` set and `npm run dev` running: submit via the real Contribute box on a venue page, watch the job logs, then open `/admin` and Apply one. Confirm the venue page reflects the change and `/admin/audit` shows a revertable entry.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-contribution-pipeline.ts package.json
git commit -m "test(contribution): end-to-end pipeline driver for the three routing cases"
```

**Milestone 1 complete — dogfoodable with auto-apply OFF.**

---

# Milestone 2 — Image moderation + quarantine (land before public)

## Task 11: SafeSearch moderation client

**Files:**
- Create: `lib/moderation/safeSearch.ts`
- Test: `scripts/test-safesearch.ts`

- [ ] **Step 1: Write the failing test (pure decision, mocked API shape)**

```typescript
// scripts/test-safesearch.ts
import assert from "node:assert/strict";
import { isSafe, type SafeSearchAnnotation } from "@/lib/moderation/safeSearch";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const clean: SafeSearchAnnotation = { adult: "UNLIKELY", violence: "VERY_UNLIKELY", racy: "POSSIBLE" };
check("clean menu passes", () => assert.equal(isSafe(clean), true));
check("LIKELY adult fails", () => assert.equal(isSafe({ ...clean, adult: "LIKELY" }), false));
check("VERY_LIKELY violence fails", () => assert.equal(isSafe({ ...clean, violence: "VERY_LIKELY" }), false));
check("LIKELY racy fails", () => assert.equal(isSafe({ ...clean, racy: "LIKELY" }), false));
check("missing annotation is treated as safe", () => assert.equal(isSafe({}), true));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-safesearch.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/moderation/safeSearch.ts
const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const BLOCK = new Set(["LIKELY", "VERY_LIKELY"]);

export interface SafeSearchAnnotation {
  adult?: string;
  violence?: string;
  racy?: string;
  medical?: string;
  spoof?: string;
}

/** Pure verdict: reject when adult/violence/racy is LIKELY+. Missing fields = safe. */
export function isSafe(a: SafeSearchAnnotation): boolean {
  return !(
    BLOCK.has(a.adult ?? "") ||
    BLOCK.has(a.violence ?? "") ||
    BLOCK.has(a.racy ?? "")
  );
}

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Run Google Cloud Vision SafeSearch on a base64 image. Fails CLOSED in production
 * (errors → rejected) so unmoderated content can't slip through; allows in dev.
 */
export async function moderateImage(base64: string, _mime: string): Promise<ModerationResult> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, reason: "Image moderation unavailable." };
    }
    return { allowed: true };
  }
  try {
    const res = await fetch(`${ENDPOINT}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ image: { content: base64 }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }],
      }),
    });
    if (!res.ok) {
      return process.env.NODE_ENV === "production"
        ? { allowed: false, reason: "Image moderation failed." }
        : { allowed: true };
    }
    const json = (await res.json()) as {
      responses?: { safeSearchAnnotation?: SafeSearchAnnotation }[];
    };
    const annotation = json.responses?.[0]?.safeSearchAnnotation ?? {};
    return isSafe(annotation)
      ? { allowed: true }
      : { allowed: false, reason: "That image looks inappropriate. Please upload a photo of the menu." };
  } catch {
    return process.env.NODE_ENV === "production"
      ? { allowed: false, reason: "Image moderation failed." }
      : { allowed: true };
  }
}
```

- [ ] **Step 4: Run test + add env**

Run: `npx tsx scripts/test-safesearch.ts`
Expected: PASS — `5 checks passed.`
Add to `.env.example`:
```
# Google Cloud Vision API key (SafeSearch) for upload moderation. Enable the Vision API.
GOOGLE_VISION_API_KEY=
```

- [ ] **Step 5: Commit**

```bash
git add lib/moderation/safeSearch.ts scripts/test-safesearch.ts package.json .env.example
git commit -m "feat(moderation): SafeSearch client (fails closed in prod)"
```

---

## Task 12: Quarantine storage + wire moderation into the upload path

**Files:**
- Modify: `lib/submit/evidenceStore.ts` (write to a private quarantine dir; add `promoteEvidence`)
- Modify: `app/api/submissions/route.ts` (moderate before store; "at least one of" validation for intent)

- [ ] **Step 1: Add a quarantine dir + promote step to evidenceStore**

Add near the existing `uploadDir()`:
```typescript
const QUARANTINE_BASE = process.env.EVIDENCE_QUARANTINE_BASE ?? "/quarantine/evidence";
function quarantineDir(): string {
  return process.env.EVIDENCE_QUARANTINE_DIR ?? join(process.cwd(), ".evidence-quarantine");
}
```
Change `saveEvidenceFile` to write into `quarantineDir()` and return a URL under `QUARANTINE_BASE` (not the public path). Add:
```typescript
/** Move a quarantined file to the public dir once a submission is approved. Returns the public URL. */
export async function promoteEvidence(quarantineUrl: string): Promise<string | null> {
  const name = quarantineUrl.split("/").pop();
  if (!name) return null;
  try {
    const { rename, mkdir } = await import("node:fs/promises");
    await mkdir(uploadDir(), { recursive: true });
    await rename(join(quarantineDir(), name), join(uploadDir(), name));
    return `${PUBLIC_BASE}/${name}`;
  } catch {
    return null;
  }
}
```
NOTE: `readEvidenceForModel` reads from `uploadDir()`. Update it to check `quarantineDir()` first, then `uploadDir()`, so the verifier can still read a not-yet-promoted photo.

- [ ] **Step 2: Moderate before storing, in the API route**

In `app/api/submissions/route.ts`, before `const storedEvidence = await saveEvidenceFile(...)`, add:
```typescript
import { moderateImage } from "@/lib/moderation/safeSearch";

// ... inside POST, after captcha/rate-limit, before saveEvidenceFile:
if (body.evidenceImage && body.evidenceImage.startsWith("data:image/")) {
  const base64 = body.evidenceImage.split(",")[1] ?? "";
  const verdict = await moderateImage(base64, "image/jpeg");
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason ?? "Image rejected." }, { status: 400 });
  }
}
```

- [ ] **Step 3: Add "at least one of note/url/photo" for intent**

Where the route validates `intent` (the note length check), require at least one signal:
```typescript
if (body.targetType === "intent") {
  const note = String((after as Record<string, unknown>).note ?? "").trim();
  const hasUrl = !!body.diff.sourceUrl?.trim();
  const hasPhoto = !!body.evidenceImage;
  if (note.length < 10 && !hasUrl && !hasPhoto) {
    return NextResponse.json({ error: "Add a sentence, a link, or a photo." }, { status: 400 });
  }
}
```

- [ ] **Step 4: Promote on apply**

In `lib/apply/engine.ts`, where a happy-hour/offering change is applied with a quarantine `sourceUrl` (starts with `/quarantine/`), call `promoteEvidence` and use the returned public URL as the stored `sourceUrl`. Read the `withSourceUrl` flow and add the promotion just before the row insert. (If this proves intricate, a simpler interim approach: promote inside `applyAction`/`autoApply` right after a successful apply and patch the audit/row — note the chosen approach in the commit.)

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: compiles. Manually: upload a normal menu photo → accepted, lands in `.evidence-quarantine`; after Apply it moves to `public/uploads/evidence`. (Test rejection by temporarily setting `GOOGLE_VISION_API_KEY` and uploading a known-unsafe image, or unit-trust `isSafe`.)

- [ ] **Step 6: Commit**

```bash
git add lib/submit/evidenceStore.ts app/api/submissions/route.ts lib/apply/engine.ts .env.example
git commit -m "feat(moderation): quarantine-until-pass evidence + SafeSearch reject at upload"
```

**Milestone 2 complete — moderation + quarantine in place.**

---

## Phase 2 (post-launch, not in this plan)

Flip `CONTRIBUTION_AUTOAPPLY=1` once first-party extractions have been eyeballed in the queue and trusted; wire Firebase admin auth and remove reliance on `DEV_ADMIN_EMAIL` before any public exposure.
