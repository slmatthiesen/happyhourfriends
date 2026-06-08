# Data Anomaly Audit + Auto-Fix System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-run, idempotent, $0-by-default system that scans already-stored venue happy-hour data for fishy records (assumed-days when the page states them, homepage-sourced HH, overlapping/duplicate windows), then re-fetches the venue's own pages and auto-corrects high-confidence cases through the audited write path — remembering which venues it has cleared so each is checked once.

**Architecture:** A pure deterministic rule catalog (`lib/audit/anomalyRules.ts`) flags stored windows; a `data_audit` ledger table provides idempotency; `audit:data` scans + reports + emits agent-review batches; `audit:fix` re-fetches via the existing free triage/parse path and applies a reversible correction (provenance fix + soft-deactivate spurious windows) through `audit_log`. The root-cause parser fixes (A/B) are ALREADY ON `origin/main` (PR #51/#52) — this plan builds only the audit system on top.

**Tech Stack:** TypeScript (strict) · tsx scripts · Drizzle ORM + drizzle-kit migrations · postgres.js · Node `assert/strict` runnable tests (no test framework). Reuses `lib/places/parseHhText.ts`, `lib/ai/freeExtract.ts`, `lib/places/windowReconcile.ts`, `lib/places/siteTriage.ts`, `lib/ai/extractHappyHours.ts` (`buildExtractRequest`), `lib/places/hhText.ts` (`scoreHhUrl`), `lib/cities/resolveCity.ts`.

**Spec:** `docs/superpowers/specs/2026-06-08-data-anomaly-audit-design.md`

---

## Background facts the engineer needs (verified against the code)

- **The shell cwd resets between Bash calls** if you `cd` into the worktree. Either `cd ../hhf-audit && <cmd>` per call, or run from the worktree root directly. All paths below are repo-relative.
- **The assumed-days marker** is the exact `notes` string written by `parseHhText.ts:364`: `"days assumed Mon–Fri (none stated)"` (note the **en-dash** `–`). Match it robustly with `notes.toLowerCase().includes("days assumed")` — do NOT hard-code the en-dash.
- **`reconcileWindows(windows, hoursJson?)`** (`lib/places/windowReconcile.ts`) returns `ReconcileResult[] = { window, active, reasons: ("operating_hours"|"overlap_conflict"|"merged_duplicate")[] }`. It MERGES same-`days|start|end` rows (reason `merged_duplicate`), flips `active=false` for operating-hours and overlap-conflict. `ReconcileWindow = { daysOfWeek, startTime, endTime, allDay }`.
- **`scoreHhUrl(url): number`** (`lib/places/hhText.ts:48`) > 0 means the URL path looks happy-hour-specific (e.g. `/happy-hour`).
- **`freeExtractFromPages(pages, {model, promptHash})`** (`lib/ai/freeExtract.ts`) returns `ExtractResult | null` (cost 0). Each `happyHours[i]` has `{ daysOfWeek, startTime, endTime, allDay, timeKnown, locationWithinVenue, notes, suspect, sourceUrl, offerings }`. `suspect=true` → should be hidden.
- **The re-fetch path** (copy from `scripts/reextract-stubs-free.ts:74-95`): `triageSite(...)` → `resolveEnrichAction(verdict, hhLikelihood(...))` → `buildExtractRequest({ ..., noRender: true })` → `freeExtractFromPages(built.pages, {...})`. All `$0`, plain HTTP.
- **`audit_log`** rows (see `resolveVenue.ts:155`) carry `{ tableName, rowId, beforeJsonb, afterJsonb, actor, reason }`. The apply engine reads these for revert, so corrections MUST write them.
- **`happy_hours`** columns (`db/schema/core.ts:182`): `venueId, daysOfWeek (smallint[]), startTime (time), endTime (time), allDay (bool), locationWithinVenue, notes, active (bool), sourceUrl, extractConfidence, timeKnown`. Natural-key unique index: `(venueId, daysOfWeek, startTime, endTime, locationWithinVenue)`.
- **City args:** scripts that target a city MUST use `requireCityArgs()` + `resolveCity(sql, slug, state)` (`lib/cities/resolveCity.ts`), per repo policy. Both `--city` and `--state` required.
- **Latest migration is `0017`** → this plan adds `0018`. Generate with `pnpm db:generate` (drizzle-kit reads `db/schema/`), never hand-number.
- **Use `pnpm`/`pnpm tsx`**, never npm/npx.

---

## File Structure

- **Create** `db/schema/ops.ts` (MODIFY — append `dataAudit` table) → drizzle generates `db/migrations/0018_*.sql`. One responsibility: the audit ledger table.
- **Create** `lib/audit/anomalyRules.ts` — pure rule catalog. `auditVenue(input) → AnomalyFlag[]`. No DB, no network, no AI. The single source of truth for "what counts as fishy."
- **Create** `lib/audit/computeCorrection.ts` — pure diff: stored windows vs re-parsed truth → a `CorrectionPlan` (updates / deactivations / inserts) + a high-confidence verdict. No DB. The testable core of the fixer.
- **Create** `scripts/test-anomaly-rules.ts` — runnable unit test for `auditVenue` + `computeCorrection` (pure, `$0`, in CI).
- **Create** `scripts/audit-data.ts` — `audit:data`: scan, write report, upsert `data_audit`, `--emit-batches`.
- **Create** `scripts/audit-fix.ts` — `audit:fix`: re-fetch + apply `CorrectionPlan` through `audit_log`, update `data_audit`.
- **Create** `scripts/test-audit-fix.ts` — `test:audit-fix`: rolled-back-txn integration over a london-shaped venue (needs live DB; NOT in CI).
- **Modify** `package.json` — add `audit:data`, `audit:fix`, `test:anomaly-rules`, `test:audit-fix` scripts.
- **Modify** `scripts/ci-tests.sh` — add `test:anomaly-rules` to the hermetic suite.

---

## Task 1: `data_audit` ledger table + migration

**Files:**
- Modify: `db/schema/ops.ts` (append table + import `text`, `jsonb`, `boolean`, `timestamp` already imported there)
- Generate: `db/migrations/0018_*.sql`

- [ ] **Step 1: Append the table to `db/schema/ops.ts`**

Add at the end of the file (the `text, jsonb, boolean, timestamp, uuid, pgTable, index` imports already exist at the top of `ops.ts`; `venues` is already imported):

```typescript
/**
 * data_audit — one row per venue scanned by the data-anomaly audit (audit:data).
 * Idempotency ledger: audit:data skips venues already here unless --recheck.
 * flags = AnomalyFlag[] from lib/audit/anomalyRules.ts; agent_verdict = the in-session
 * sniff-test note; resolution tracks the lifecycle (scanned → clean | fixed | reported).
 */
export const dataAudit = pgTable(
  "data_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .unique()
      .references(() => venues.id, { onDelete: "cascade" }),
    auditedAt: timestamp("audited_at", { withTimezone: true }).notNull().defaultNow(),
    flags: jsonb("flags").notNull().default([]),
    agentVerdict: text("agent_verdict"),
    resolution: text("resolution").notNull().default("scanned"),
    fixApplied: boolean("fix_applied").notNull().default(false),
  },
  (t) => [index("data_audit_resolution_idx").on(t.resolution)],
);
```

- [ ] **Step 2: Generate the migration**

Run: `cd ../hhf-audit && pnpm db:generate`
Expected: a new `db/migrations/0018_*.sql` creating `data_audit`, and an updated `db/migrations/meta/_journal.json`. Read the generated SQL to confirm it only ADDs the table (no drops).

- [ ] **Step 3: Apply the migration to the local DB**

Run: `cd ../hhf-audit && pnpm db:migrate`
Expected: applies `0018` with no error. (Requires Docker Postgres up + `DATABASE_URL` in `.env`. If down: `docker compose up -d` first.)

- [ ] **Step 4: Verify the table exists**

Run: `cd ../hhf-audit && pnpm tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL!); const r=await sql\`select column_name from information_schema.columns where table_name='data_audit' order by ordinal_position\`; console.log(r.map(x=>x.column_name).join(', ')); await sql.end();"`
Expected: `id, venue_id, audited_at, flags, agent_verdict, resolution, fix_applied`

- [ ] **Step 5: Commit**

```bash
cd ../hhf-audit && git add db/schema/ops.ts db/migrations/ && git commit -m "feat(audit): add data_audit ledger table (migration 0018)"
```

---

## Task 2: `lib/audit/anomalyRules.ts` — pure rule catalog

**Files:**
- Create: `lib/audit/anomalyRules.ts`
- Test: `scripts/test-anomaly-rules.ts` (created here, extended in Task 3)

- [ ] **Step 1: Write the failing test** (`scripts/test-anomaly-rules.ts`)

```typescript
/**
 * Runnable unit checks for the pure data-anomaly rule catalog (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-anomaly-rules.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { auditVenue, type VenueAuditInput } from "@/lib/audit/anomalyRules";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// The grounding case: London Bar & Grill's STORED data (two active assumed-days windows,
// one homepage-sourced, the /menu/ one overlapping the /happy-hour/ one on Mon–Fri).
const london: VenueAuditInput = {
  websiteUrl: "https://londonbargrill.com",
  hoursJson: null,
  windows: [
    {
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false,
      active: true, sourceUrl: "https://londonbargrill.com/", notes: "days assumed Mon–Fri (none stated)",
    },
    {
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "18:00:00", endTime: "21:00:00", allDay: false,
      active: true, sourceUrl: "https://londonbargrill.com/menu/", notes: "days assumed Mon–Fri (none stated)",
    },
  ],
};

check("london: flags assumed_days_avoidable", () => {
  const codes = auditVenue(london).map((f) => f.code);
  assert.ok(codes.includes("assumed_days_avoidable"));
});
check("london: flags homepage_sourced_hh (the '/' window)", () => {
  const codes = auditVenue(london).map((f) => f.code);
  assert.ok(codes.includes("homepage_sourced_hh"));
});
check("london: flags overlapping_windows (16–19 vs 18–21 on Mon–Fri)", () => {
  const codes = auditVenue(london).map((f) => f.code);
  assert.ok(codes.includes("overlapping_windows"));
});

check("clean venue: a single real-days HH-page-sourced window yields NO flags", () => {
  const flags = auditVenue({
    websiteUrl: "https://example.com",
    hoursJson: null,
    windows: [{
      daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false,
      active: true, sourceUrl: "https://example.com/happy-hour/", notes: null,
    }],
  });
  assert.equal(flags.length, 0);
});

check("duplicate_windows: same days|start|end, differing source", () => {
  const codes = auditVenue({
    websiteUrl: "https://x.com", hoursJson: null,
    windows: [
      { daysOfWeek: [1], startTime: "15:00:00", endTime: "17:00:00", allDay: false, active: true, sourceUrl: "https://x.com/a", notes: null },
      { daysOfWeek: [1], startTime: "15:00:00", endTime: "17:00:00", allDay: false, active: true, sourceUrl: "https://x.com/b", notes: null },
    ],
  }).map((f) => f.code);
  assert.ok(codes.includes("duplicate_windows"));
});

check("implausible_active: an active >6h window flags", () => {
  const codes = auditVenue({
    websiteUrl: "https://y.com", hoursJson: null,
    windows: [{ daysOfWeek: [1], startTime: "10:00:00", endTime: "20:00:00", allDay: false, active: true, sourceUrl: "https://y.com/happy-hour", notes: null }],
  }).map((f) => f.code);
  assert.ok(codes.includes("implausible_active"));
});

check("inactive windows are ignored (only audit live data)", () => {
  const flags = auditVenue({
    websiteUrl: "https://z.com", hoursJson: null,
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "18:00:00", endTime: "21:00:00", allDay: false, active: false, sourceUrl: "https://z.com/", notes: "days assumed Mon–Fri (none stated)" }],
  });
  assert.equal(flags.length, 0);
});

console.log(`\n✓ ${passed} anomaly-rule checks passed.`);
```

- [ ] **Step 2: Run it to confirm it fails (module missing)**

Run: `cd ../hhf-audit && pnpm tsx scripts/test-anomaly-rules.ts`
Expected: FAIL — cannot find module `@/lib/audit/anomalyRules`.

- [ ] **Step 3: Implement `lib/audit/anomalyRules.ts`**

```typescript
/**
 * anomalyRules — pure, deterministic catalog of "this stored happy-hour data looks fishy"
 * predicates. NO DB, NO network, NO AI ($0, unit-tested). Consumed by scripts/audit-data.ts.
 *
 * Only ACTIVE windows are audited (hidden rows are already withheld from users). Shape rules
 * (overlap / operating-hours / duplicate) reuse reconcileWindows so the audit and the persist
 * gate agree. Provenance rules (assumed-days, homepage-sourced) are audit-only.
 *
 * severity governs the fixer: `auto_fixable` flags may auto-apply a re-fetch correction;
 * `report` flags are surfaced for operator spot-check only.
 */
import { reconcileWindows, durationMin, type ReconcileWindow } from "@/lib/places/windowReconcile";
import { scoreHhUrl } from "@/lib/places/hhText";
import type { OpenPeriod } from "@/lib/geo/timezone";

export interface AuditWindow {
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  active: boolean;
  sourceUrl: string | null;
  notes: string | null;
}

export interface VenueAuditInput {
  websiteUrl: string | null;
  hoursJson: OpenPeriod[] | null;
  windows: AuditWindow[];
}

export type AnomalySeverity = "auto_fixable" | "report";
export type AnomalyCode =
  | "assumed_days_avoidable"
  | "homepage_sourced_hh"
  | "overlapping_windows"
  | "duplicate_windows"
  | "operating_hours_active"
  | "implausible_active";

export interface AnomalyFlag {
  code: AnomalyCode;
  severity: AnomalySeverity;
  evidence: string;
}

const SEVERITY: Record<AnomalyCode, AnomalySeverity> = {
  assumed_days_avoidable: "auto_fixable",
  duplicate_windows: "auto_fixable",
  implausible_active: "auto_fixable",
  homepage_sourced_hh: "report",
  overlapping_windows: "report",
  operating_hours_active: "report",
};

function flag(code: AnomalyCode, evidence: string): AnomalyFlag {
  return { code, severity: SEVERITY[code], evidence };
}

/** notes carries the parser's assumed-days marker (parseHhText writes "days assumed Mon–Fri …"). */
function isAssumedDays(notes: string | null): boolean {
  return !!notes && notes.toLowerCase().includes("days assumed");
}

/** sourceUrl path is the bare domain or "/" (not an HH-specific page). */
function isHomepageSource(sourceUrl: string | null): boolean {
  if (!sourceUrl) return false;
  try {
    const p = new URL(sourceUrl).pathname.replace(/\/+$/, "");
    return p === "" || p === "/";
  } catch {
    return false;
  }
}

/**
 * Retroactive plausibility check from STORED shape (mirrors parseHhText's plausible=false
 * cases we can see post-hoc): duration > 6h, or degenerate (both times known, duration ≤ 0).
 */
function isImplausibleShape(w: AuditWindow): boolean {
  if (w.allDay) return false; // all-day handled by realness gate, not here
  const rw: ReconcileWindow = { daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay };
  const d = durationMin(rw);
  if (d === null) return false; // open-ended start/end — not a shape we can judge
  return d > 6 * 60 || d <= 0;
}

export function auditVenue(input: VenueAuditInput): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const active = input.windows.filter((w) => w.active);
  if (active.length === 0) return flags;

  // --- Provenance + shape, per-window ---
  for (const w of active) {
    if (isAssumedDays(w.notes)) {
      flags.push(flag("assumed_days_avoidable", `${w.sourceUrl ?? "?"} — ${w.notes}`));
    }
    if (isHomepageSource(w.sourceUrl)) {
      flags.push(flag("homepage_sourced_hh", `HH window sourced from homepage: ${w.sourceUrl}`));
    }
    if (isImplausibleShape(w)) {
      flags.push(flag("implausible_active", `active window ${w.startTime}–${w.endTime} is implausible (>6h or degenerate)`));
    }
  }

  // --- Shape across active windows, via the shared reconcile gate ---
  const recon = reconcileWindows(
    active.map((w) => ({ daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay })),
    input.hoursJson,
  );
  let overlapped = false;
  let operating = false;
  let duplicated = false;
  for (const r of recon) {
    if (r.reasons.includes("overlap_conflict")) overlapped = true;
    if (r.reasons.includes("operating_hours")) operating = true;
    if (r.reasons.includes("merged_duplicate")) duplicated = true;
  }
  if (overlapped) flags.push(flag("overlapping_windows", "two active windows overlap on shared days"));
  if (operating) flags.push(flag("operating_hours_active", "an active window looks like operating hours"));
  if (duplicated) flags.push(flag("duplicate_windows", "two active windows share days|start|end"));

  // De-dup identical (code) flags so a venue with 3 assumed windows reports the code once.
  const seen = new Set<string>();
  return flags.filter((f) => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
}

/** True when the venue has ≥1 auto_fixable flag (the fixer's candidacy gate). */
export function hasAutoFixable(flags: AnomalyFlag[]): boolean {
  return flags.some((f) => f.severity === "auto_fixable");
}

/** A re-parsed correction is HIGH-CONFIDENCE (safe to auto-apply) when every corrected
 *  window has REAL days, ≥1 is sourced from an HH-specific page, and reconcile keeps all. */
export function isHighConfidenceCorrection(
  corrected: { daysOfWeek: number[]; startTime: string | null; endTime: string | null; allDay: boolean; sourceUrl: string | null; notes: string | null }[],
): boolean {
  if (corrected.length === 0) return false;
  if (corrected.some((w) => isAssumedDays(w.notes))) return false;
  if (!corrected.some((w) => (w.sourceUrl ? scoreHhUrl(w.sourceUrl) > 0 : false))) return false;
  const recon = reconcileWindows(
    corrected.map((w) => ({ daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay })),
  );
  return recon.every((r) => r.active);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ../hhf-audit && pnpm tsx scripts/test-anomaly-rules.ts`
Expected: PASS — all checks green.

- [ ] **Step 5: Typecheck**

Run: `cd ../hhf-audit && pnpm typecheck`
Expected: clean (or only the 2 pre-existing Phase-0 lint/ts issues noted in CLAUDE.md, unrelated to these files).

- [ ] **Step 6: Commit**

```bash
cd ../hhf-audit && git add lib/audit/anomalyRules.ts scripts/test-anomaly-rules.ts && git commit -m "feat(audit): pure anomaly-rule catalog (auditVenue) + london fixtures"
```

---

## Task 3: `lib/audit/computeCorrection.ts` — pure correction diff

**Files:**
- Create: `lib/audit/computeCorrection.ts`
- Test: `scripts/test-anomaly-rules.ts` (extend)

- [ ] **Step 1: Add failing tests to `scripts/test-anomaly-rules.ts`**

Insert before the final `console.log`:

```typescript
import { computeCorrection, type StoredRow } from "@/lib/audit/computeCorrection";

const storedLondon: StoredRow[] = [
  { id: "row-home", daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, active: true, sourceUrl: "https://londonbargrill.com/", notes: "days assumed Mon–Fri (none stated)" },
  { id: "row-menu", daysOfWeek: [1, 2, 3, 4, 5], startTime: "18:00:00", endTime: "21:00:00", allDay: false, active: true, sourceUrl: "https://londonbargrill.com/menu/", notes: "days assumed Mon–Fri (none stated)" },
];
// What the FIXED free parser returns from /happy-hour/: one real-days window, same clock as the home row.
const correctedLondon = [
  { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://londonbargrill.com/happy-hour/", notes: null },
];

check("computeCorrection: updates the matching home row's provenance, deactivates /menu/", () => {
  const plan = computeCorrection(storedLondon, correctedLondon);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "row-home");
  assert.equal(plan.updates[0].sourceUrl, "https://londonbargrill.com/happy-hour/");
  assert.equal(plan.updates[0].notes, null);
  assert.deepEqual(plan.deactivations, ["row-menu"]);
  assert.equal(plan.inserts.length, 0);
});

check("computeCorrection: a corrected window with no stored match becomes an insert", () => {
  const plan = computeCorrection(
    [{ id: "r1", daysOfWeek: [6], startTime: "12:00:00", endTime: "15:00:00", allDay: false, active: true, sourceUrl: "https://x.com/", notes: null }],
    [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://x.com/happy-hour", notes: null }],
  );
  assert.equal(plan.inserts.length, 1);
  assert.deepEqual(plan.deactivations, ["r1"]);
});

check("computeCorrection: no provenance change → no-op update", () => {
  const plan = computeCorrection(
    [{ id: "r1", daysOfWeek: [1], startTime: "16:00:00", endTime: "19:00:00", allDay: false, active: true, sourceUrl: "https://x.com/happy-hour", notes: null }],
    [{ daysOfWeek: [1], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://x.com/happy-hour", notes: null }],
  );
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.deactivations.length, 0);
  assert.equal(plan.inserts.length, 0);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd ../hhf-audit && pnpm tsx scripts/test-anomaly-rules.ts`
Expected: FAIL — cannot find module `@/lib/audit/computeCorrection`.

- [ ] **Step 3: Implement `lib/audit/computeCorrection.ts`**

```typescript
/**
 * computeCorrection — pure diff between a venue's STORED happy-hour rows and the window-set
 * a fresh free re-parse produced. Produces a reversible plan the fixer applies through
 * audit_log. NO DB, NO network ($0, unit-tested).
 *
 * Matching is by natural key (sorted days | start | end | allDay):
 *   - stored ACTIVE row matched by a corrected window → UPDATE provenance (source/notes) if it
 *     differs; otherwise no-op.
 *   - stored ACTIVE row NOT matched → DEACTIVATE (a spurious/superseded window).
 *   - corrected window with no stored match → INSERT.
 * Inactive stored rows are left untouched (already withheld).
 */
export interface StoredRow {
  id: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  active: boolean;
  sourceUrl: string | null;
  notes: string | null;
}

export interface CorrectedWindow {
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  sourceUrl: string | null;
  notes: string | null;
}

export interface CorrectionPlan {
  updates: { id: string; sourceUrl: string | null; notes: string | null }[];
  deactivations: string[]; // row ids
  inserts: CorrectedWindow[];
}

function key(w: { daysOfWeek: number[]; startTime: string | null; endTime: string | null; allDay: boolean }): string {
  const days = [...new Set(w.daysOfWeek)].sort((a, b) => a - b).join(",");
  return `${days}|${w.startTime ?? ""}|${w.endTime ?? ""}|${w.allDay}`;
}

export function computeCorrection(stored: StoredRow[], corrected: CorrectedWindow[]): CorrectionPlan {
  const plan: CorrectionPlan = { updates: [], deactivations: [], inserts: [] };
  const activeStored = stored.filter((r) => r.active);
  const correctedByKey = new Map(corrected.map((c) => [key(c), c]));
  const matchedKeys = new Set<string>();

  for (const row of activeStored) {
    const match = correctedByKey.get(key(row));
    if (match) {
      matchedKeys.add(key(row));
      if (match.sourceUrl !== row.sourceUrl || match.notes !== row.notes) {
        plan.updates.push({ id: row.id, sourceUrl: match.sourceUrl, notes: match.notes });
      }
    } else {
      plan.deactivations.push(row.id);
    }
  }

  for (const c of corrected) {
    if (!matchedKeys.has(key(c))) plan.inserts.push(c);
  }
  return plan;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ../hhf-audit && pnpm tsx scripts/test-anomaly-rules.ts`
Expected: PASS — all checks (anomaly + correction) green.

- [ ] **Step 5: Commit**

```bash
cd ../hhf-audit && git add lib/audit/computeCorrection.ts scripts/test-anomaly-rules.ts && git commit -m "feat(audit): pure computeCorrection diff (update/deactivate/insert plan)"
```

---

## Task 4: `scripts/audit-data.ts` — scan + report + ledger (`audit:data`)

**Files:**
- Create: `scripts/audit-data.ts`
- Modify: `package.json` (add `audit:data`)

- [ ] **Step 1: Implement `scripts/audit-data.ts`**

```typescript
/**
 * audit:data — scan a city's STORED venue happy-hour data for anomalies (lib/audit/anomalyRules),
 * write a review report, and upsert one data_audit row per venue (idempotency ledger). $0:
 * no network, no AI — it reads only what's already in the DB.
 *
 * Usage: pnpm tsx scripts/audit-data.ts --city <slug> --state <code> [--recheck] [--emit-batches] [--limit N]
 *   --recheck       re-scan venues already in data_audit
 *   --emit-batches  also write docs/audit-batches/<slug>-<n>.md for the in-session agent sniff-test
 */
import "dotenv/config";
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { auditVenue, type AuditWindow, type AnomalyFlag } from "@/lib/audit/anomalyRules";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import type { OpenPeriod } from "@/lib/geo/timezone";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const RECHECK = process.argv.includes("--recheck");
const EMIT = process.argv.includes("--emit-batches");
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const BATCH_SIZE = 20;

interface VenueRow {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  hours_json: OpenPeriod[] | null;
}

async function main() {
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const city = await resolveCity(sql, slug, state);

    const venuesRows = await sql<VenueRow[]>`
      SELECT v.id, v.name, v.slug, v.website_url, v.hours_json
      FROM venues v
      WHERE v.city_id = ${city.id}
        AND v.status = 'active'
        ${RECHECK ? sql`` : sql`AND NOT EXISTS (SELECT 1 FROM data_audit da WHERE da.venue_id = v.id)`}
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(`[audit:data] ${venuesRows.length} venue(s) to scan in ${city.name}. $0 — no API/network.\n`);

    const report: { name: string; slug: string; website: string | null; flags: AnomalyFlag[]; windows: AuditWindow[] }[] = [];
    let flagged = 0;

    for (const v of venuesRows) {
      const hhRows = await sql<AuditWindow[]>`
        SELECT days_of_week AS "daysOfWeek", start_time AS "startTime", end_time AS "endTime",
               all_day AS "allDay", active, source_url AS "sourceUrl", notes
        FROM happy_hours WHERE venue_id = ${v.id}`;
      const flags = auditVenue({ websiteUrl: v.website_url, hoursJson: v.hours_json, windows: hhRows });
      const resolution = flags.length === 0 ? "clean" : "scanned";
      if (flags.length > 0) {
        flagged++;
        report.push({ name: v.name, slug: v.slug, website: v.website_url, flags, windows: hhRows.filter((w) => w.active) });
      }
      await sql`
        INSERT INTO data_audit (venue_id, flags, resolution, audited_at)
        VALUES (${v.id}, ${sql.json(flags)}, ${resolution}, now())
        ON CONFLICT (venue_id) DO UPDATE
          SET flags = EXCLUDED.flags, resolution = EXCLUDED.resolution, audited_at = now()`;
    }

    console.log(`Scanned ${venuesRows.length}; flagged ${flagged}.`);

    // Report files.
    mkdirSync("docs", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const base = `docs/${city.slug}-data-audit-${date}`;
    writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
    const md = [`# Data audit — ${city.name} (${date})`, "", `Flagged ${flagged} of ${venuesRows.length} scanned.`, ""];
    for (const r of report) {
      md.push(`## ${r.name}  (\`${r.slug}\`)`);
      md.push(`Website: ${r.website ?? "—"}`);
      md.push(`Flags: ${r.flags.map((f) => `\`${f.code}\`(${f.severity})`).join(", ")}`);
      for (const f of r.flags) md.push(`  - ${f.code}: ${f.evidence}`);
      md.push("Active windows:");
      for (const w of r.windows) md.push(`  - ${JSON.stringify(w.daysOfWeek)} ${w.startTime ?? "open"}–${w.endTime ?? "close"} src=${w.sourceUrl ?? "—"}`);
      md.push("");
    }
    writeFileSync(`${base}.md`, md.join("\n"));
    console.log(`Report → ${base}.{md,json}`);

    if (EMIT && report.length > 0) {
      mkdirSync("docs/audit-batches", { recursive: true });
      for (let i = 0; i < report.length; i += BATCH_SIZE) {
        const batch = report.slice(i, i + BATCH_SIZE);
        const n = i / BATCH_SIZE + 1;
        const lines = [`# Audit batch ${n} — ${city.name} (data only; agent sniff-test)`, ""];
        for (const r of batch) {
          lines.push(`### ${r.name}`);
          for (const w of r.windows) lines.push(`- ${JSON.stringify(w.daysOfWeek)} ${w.startTime ?? "open"}–${w.endTime ?? "close"} src=${w.sourceUrl ?? "—"} notes=${w.notes ?? "—"}`);
          lines.push("");
        }
        writeFileSync(`docs/audit-batches/${city.slug}-${n}.md`, lines.join("\n"));
      }
      console.log(`Emitted ${Math.ceil(report.length / BATCH_SIZE)} agent-review batch(es) → docs/audit-batches/${city.slug}-*.md`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

Add to `package.json` `scripts` (next to `reconcile:windows`):

```json
"audit:data": "tsx scripts/audit-data.ts",
```

- [ ] **Step 3: Typecheck**

Run: `cd ../hhf-audit && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Smoke-run against Oakland (read-only scan; writes data_audit + report)**

Run: `cd ../hhf-audit && pnpm audit:data --city oakland --state ca`
Expected: prints scanned/flagged counts; writes `docs/oakland-data-audit-<date>.{md,json}`; London appears in the report with `assumed_days_avoidable`, `homepage_sourced_hh`, `overlapping_windows`. Read the `.md` to confirm.

- [ ] **Step 5: Verify idempotency**

Run: `cd ../hhf-audit && pnpm audit:data --city oakland --state ca`
Expected: "0 venue(s) to scan" (all already in `data_audit`). Then `pnpm audit:data --city oakland --state ca --recheck` re-scans all.

- [ ] **Step 6: Commit**

```bash
cd ../hhf-audit && git add scripts/audit-data.ts package.json && git commit -m "feat(audit): audit:data scan + report + data_audit ledger + --emit-batches"
```

---

## Task 5: `scripts/audit-fix.ts` — re-fetch + correct (`audit:fix`)

**Files:**
- Create: `scripts/audit-fix.ts`
- Modify: `package.json` (add `audit:fix`)

- [ ] **Step 1: Implement `scripts/audit-fix.ts`**

```typescript
/**
 * audit:fix — for venues flagged auto_fixable by audit:data, re-fetch the venue's OWN pages
 * (free triage + plain HTTP), re-parse with the FIXED free parser, and apply a reversible
 * correction: update the surviving window's provenance, soft-deactivate spurious windows,
 * insert any new ones. Auto-applies ONLY high-confidence corrections; everything else is
 * reported. Free by default. Dry-run unless --apply.
 *
 * Usage: pnpm tsx scripts/audit-fix.ts --city <slug> --state <code> [--apply] [--limit N]
 */
import "dotenv/config";
import postgres from "postgres";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { isHighConfidenceCorrection } from "@/lib/audit/anomalyRules";
import { computeCorrection, type StoredRow, type CorrectedWindow } from "@/lib/audit/computeCorrection";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;

interface FlaggedVenue {
  id: string;
  name: string;
  website_url: string | null;
  flags: { code: string; severity: string }[];
}

async function main() {
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const city = await resolveCity(sql, slug, state);

    const flagged = await sql<FlaggedVenue[]>`
      SELECT v.id, v.name, v.website_url, da.flags
      FROM data_audit da
      JOIN venues v ON v.id = da.venue_id
      WHERE v.city_id = ${city.id}
        AND da.fix_applied = false
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(da.flags) f WHERE f->>'severity' = 'auto_fixable')
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(`[${APPLY ? "APPLY" : "DRY RUN"}] ${flagged.length} auto-fixable venue(s) in ${city.name}. Free re-fetch.\n`);
    let fixed = 0;
    let reported = 0;

    for (const v of flagged) {
      if (!v.website_url) { reported++; continue; }

      // Re-fetch + free re-parse (same path as reextract:stubs:free).
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: null, types: null, name: v.name }));
      if (decided.action !== "extract") { console.log(`  – ${v.name}: site not extractable → report`); reported++; continue; }
      const built = await buildExtractRequest({
        venueName: v.name,
        websiteUrl: verdict.kind === "real" ? verdict.url : null,
        otherUrl: null,
        cityName: city.name,
        priorityUrls: decided.priorityUrls,
        noRender: true,
      });
      const free = freeExtractFromPages(built.pages, { model: "deterministic-html-v1", promptHash: built.promptHash });

      const corrected: CorrectedWindow[] = (free?.happyHours ?? [])
        .filter((h) => !h.suspect)
        .map((h) => ({ daysOfWeek: h.daysOfWeek, startTime: h.startTime, endTime: h.endTime, allDay: h.allDay, sourceUrl: h.sourceUrl, notes: h.notes }));

      if (!isHighConfidenceCorrection(corrected)) {
        console.log(`  ⚑ ${v.name}: re-parse not high-confidence (${corrected.length} window(s)) → report only`);
        reported++;
        continue;
      }

      const stored = await sql<StoredRow[]>`
        SELECT id, days_of_week AS "daysOfWeek", start_time AS "startTime", end_time AS "endTime",
               all_day AS "allDay", active, source_url AS "sourceUrl", notes
        FROM happy_hours WHERE venue_id = ${v.id}`;
      const plan = computeCorrection(stored, corrected);

      if (plan.updates.length === 0 && plan.deactivations.length === 0 && plan.inserts.length === 0) {
        console.log(`  ✓ ${v.name}: stored data already matches re-parse → mark fixed`);
        if (APPLY) await sql`UPDATE data_audit SET resolution='clean', fix_applied=true WHERE venue_id=${v.id}`;
        fixed++;
        continue;
      }

      const desc = `${plan.updates.length} update, ${plan.deactivations.length} deactivate, ${plan.inserts.length} insert`;
      if (!APPLY) {
        console.log(`  ✓ ${v.name}: WOULD apply [${desc}]`);
        fixed++;
        continue;
      }

      await sql.begin(async (tx) => {
        for (const u of plan.updates) {
          const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${u.id}`;
          await tx`UPDATE happy_hours SET source_url=${u.sourceUrl}, notes=${u.notes}, active=true, updated_at=now() WHERE id=${u.id}`;
          await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                   VALUES ('happy_hours', ${u.id}, ${tx.json(before)}, ${tx.json({ sourceUrl: u.sourceUrl, notes: u.notes, active: true })}, 'audit-fix', 'data audit: provenance correction')`;
        }
        for (const id of plan.deactivations) {
          const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${id}`;
          await tx`UPDATE happy_hours SET active=false, updated_at=now() WHERE id=${id}`;
          await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                   VALUES ('happy_hours', ${id}, ${tx.json(before)}, ${tx.json({ active: false })}, 'audit-fix', 'data audit: deactivate spurious window')`;
        }
        for (const ins of plan.inserts) {
          const [row] = await tx`
            INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time, all_day, location_within_venue, notes, active, source_url, time_known)
            VALUES (${v.id}, ${ins.daysOfWeek}, ${ins.startTime}, ${ins.endTime}, ${ins.allDay}, 'all', ${ins.notes}, true, ${ins.sourceUrl}, ${ins.startTime !== null})
            ON CONFLICT DO NOTHING RETURNING id`;
          if (row) {
            await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                     VALUES ('happy_hours', ${row.id}, null, ${tx.json({ ...ins, active: true })}, 'audit-fix', 'data audit: insert corrected window')`;
          }
        }
        await tx`UPDATE data_audit SET resolution='fixed', fix_applied=true WHERE venue_id=${v.id}`;
      });
      console.log(`  ✓ ${v.name}: APPLIED [${desc}]`);
      fixed++;
    }

    console.log(`\n${APPLY ? "Applied" : "Would fix"}: ${fixed}; reported: ${reported}.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

Add to `package.json` `scripts`:

```json
"audit:fix": "tsx scripts/audit-fix.ts",
```

- [ ] **Step 3: Typecheck**

Run: `cd ../hhf-audit && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Dry-run against Oakland**

Run: `cd ../hhf-audit && pnpm audit:fix --city oakland --state ca`
Expected: prints `WOULD apply [1 update, 1 deactivate, 0 insert]` for London (re-fetches its `/happy-hour/` page → one real-days window). No DB writes. If London's site is unreachable at run time, it will report instead — note that and move to the integration test (Task 6) which is hermetic.

- [ ] **Step 5: Commit**

```bash
cd ../hhf-audit && git add scripts/audit-fix.ts package.json && git commit -m "feat(audit): audit:fix re-fetch + reversible correction (free-default, dry-run default)"
```

---

## Task 6: Fixer integration test (rolled-back txn, london-shaped) — `test:audit-fix`

**Files:**
- Create: `scripts/test-audit-fix.ts`
- Modify: `package.json` (add `test:audit-fix`)

This test does NOT hit the network: it builds a london-shaped venue + two stored windows in a transaction, calls `computeCorrection` with a hand-built corrected set (simulating the re-parse), applies the plan with the SAME SQL the script uses, asserts the DB end-state, then rolls back. It proves the apply SQL + `audit_log` writes are correct without depending on a live website.

- [ ] **Step 1: Implement `scripts/test-audit-fix.ts`**

```typescript
/**
 * Integration test for the audit:fix apply step. Builds a london-shaped venue + 2 stored
 * windows in a transaction, applies computeCorrection's plan with the script's SQL, asserts
 * the end-state, and ROLLS BACK (DB unchanged). Needs a live Postgres (DATABASE_URL).
 * Run: pnpm tsx scripts/test-audit-fix.ts — exits non-zero on any failure. NOT in CI.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { computeCorrection, type StoredRow, type CorrectedWindow } from "@/lib/audit/computeCorrection";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  let passed = 0;
  try {
    await sql.begin(async (tx) => {
      const [city] = await tx<{ id: string }[]>`
        INSERT INTO cities (name, slug, state, country, default_timezone, currency_code)
        VALUES ('AuditVille', 'auditville-fix', 'CA', 'US', 'America/Los_Angeles', 'USD') RETURNING id`;
      const [venue] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, status, data_completeness, website_url)
        VALUES (${city.id}, 'London Test', 'london-test', 'active', 'complete', 'https://example.com') RETURNING id`;
      const [home] = await tx<{ id: string }[]>`
        INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time, all_day, location_within_venue, notes, active, source_url, time_known)
        VALUES (${venue.id}, '{1,2,3,4,5}', '16:00', '19:00', false, 'all', 'days assumed Mon–Fri (none stated)', true, 'https://example.com/', true) RETURNING id`;
      const [menu] = await tx<{ id: string }[]>`
        INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time, all_day, location_within_venue, notes, active, source_url, time_known)
        VALUES (${venue.id}, '{1,2,3,4,5}', '18:00', '21:00', false, 'all', 'days assumed Mon–Fri (none stated)', true, 'https://example.com/menu/', true) RETURNING id`;

      const stored = await tx<StoredRow[]>`
        SELECT id, days_of_week AS "daysOfWeek", start_time AS "startTime", end_time AS "endTime",
               all_day AS "allDay", active, source_url AS "sourceUrl", notes
        FROM happy_hours WHERE venue_id = ${venue.id}`;
      const corrected: CorrectedWindow[] = [
        { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:00:00", endTime: "19:00:00", allDay: false, sourceUrl: "https://example.com/happy-hour/", notes: null },
      ];
      const plan = computeCorrection(stored, corrected);

      // Apply (mirrors audit-fix.ts).
      for (const u of plan.updates) {
        const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${u.id}`;
        await tx`UPDATE happy_hours SET source_url=${u.sourceUrl}, notes=${u.notes}, active=true, updated_at=now() WHERE id=${u.id}`;
        await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                 VALUES ('happy_hours', ${u.id}, ${tx.json(before)}, ${tx.json({ sourceUrl: u.sourceUrl, notes: u.notes, active: true })}, 'audit-fix', 'test')`;
      }
      for (const id of plan.deactivations) {
        await tx`UPDATE happy_hours SET active=false WHERE id=${id}`;
        await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                 VALUES ('happy_hours', ${id}, ${tx.json({ active: true })}, ${tx.json({ active: false })}, 'audit-fix', 'test')`;
      }

      const active = await tx<{ id: string; source_url: string; notes: string | null; start_time: string }[]>`
        SELECT id, source_url, notes, start_time FROM happy_hours WHERE venue_id=${venue.id} AND active=true`;
      assert.equal(active.length, 1, "exactly one active window remains");
      assert.equal(active[0].id, home.id, "the 16–19 window survives");
      assert.equal(active[0].source_url, "https://example.com/happy-hour/", "provenance corrected to /happy-hour/");
      assert.equal(active[0].notes, null, "assumed-days note cleared");

      const [menuRow] = await tx<{ active: boolean }[]>`SELECT active FROM happy_hours WHERE id=${menu.id}`;
      assert.equal(menuRow.active, false, "the /menu/ window is deactivated");

      const audits = await tx<{ c: string }[]>`SELECT count(*)::text AS c FROM audit_log WHERE actor='audit-fix' AND row_id IN (${home.id}, ${menu.id})`;
      assert.equal(audits[0].c, "2", "two audit_log rows written (1 update, 1 deactivate)");
      passed += 5;
      console.log("  ✓ london-shaped venue corrects to one active /happy-hour/ window with audit trail");

      throw new Error("ROLLBACK"); // leave DB unchanged
    }).catch((e) => {
      if (e.message !== "ROLLBACK") throw e;
    });
    console.log(`\n✓ ${passed} audit-fix integration assertions passed (rolled back).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

Add to `package.json` `scripts`:

```json
"test:audit-fix": "tsx scripts/test-audit-fix.ts",
```

- [ ] **Step 3: Run it**

Run: `cd ../hhf-audit && pnpm test:audit-fix`
Expected: `✓ 5 audit-fix integration assertions passed (rolled back).` (Requires Docker Postgres up.)

- [ ] **Step 4: Confirm rollback left no trace**

Run: `cd ../hhf-audit && pnpm tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL!); const r=await sql\`select count(*)::int n from venues where slug='london-test'\`; console.log('london-test venues:', r[0].n); await sql.end();"`
Expected: `london-test venues: 0`

- [ ] **Step 5: Commit**

```bash
cd ../hhf-audit && git add scripts/test-audit-fix.ts package.json && git commit -m "test(audit): rolled-back integration proves london correction + audit trail"
```

---

## Task 7: Wire CI, run the real Oakland pass, verify London corrects

**Files:**
- Modify: `scripts/ci-tests.sh`

- [ ] **Step 1: Add the pure test to the hermetic CI suite**

In `scripts/ci-tests.sh`, add to the `TESTS=( … )` array (after `test:window-reconcile`):

```bash
  test:anomaly-rules
```

And add the script to `package.json`:

```json
"test:anomaly-rules": "tsx scripts/test-anomaly-rules.ts",
```

- [ ] **Step 2: Run the full hermetic suite (DB/keys unset) to confirm it's green and hermetic**

Run: `cd ../hhf-audit && env -u DATABASE_URL pnpm test:anomaly-rules`
Expected: PASS with no DB (it's pure). Then `cd ../hhf-audit && bash scripts/ci-tests.sh` runs the whole suite green.

- [ ] **Step 3: End-to-end on Oakland — scan, then APPLY the fix to London**

```bash
cd ../hhf-audit && pnpm audit:data --city oakland --state ca --recheck
cd ../hhf-audit && pnpm audit:fix --city oakland --state ca --apply
```
Expected: `audit:fix` prints `APPLIED [1 update, 1 deactivate, 0 insert]` for London Bar & Grill (if its site is reachable). If unreachable, it reports — the hermetic Task 6 test already proves the apply logic, so this is the live confirmation, not the proof.

- [ ] **Step 4: Verify the London DB row is now correct**

Run: `cd ../hhf-audit && pnpm tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL!); const r=await sql\`select start_time,end_time,active,source_url,notes from happy_hours h join venues v on v.id=h.venue_id where v.slug='london-bar-grill' order by active desc\`; console.table(r); await sql.end();"`
Expected: one `active=true` row `16:00–19:00` sourced from `/happy-hour/` with `notes=null`; the `18:00–21:00` row `active=false`. (If the live re-fetch couldn't reach the site, this remains the old data — flag that to the operator rather than hand-editing the row.)

- [ ] **Step 5: Typecheck + commit**

```bash
cd ../hhf-audit && pnpm typecheck
cd ../hhf-audit && git add scripts/ci-tests.sh package.json && git commit -m "test(audit): add test:anomaly-rules to hermetic CI suite"
```

- [ ] **Step 6: Open the PR**

```bash
cd ../hhf-audit && git push -u origin feat/data-anomaly-audit
cd ../hhf-audit && gh pr create --title "feat(audit): data-anomaly audit + auto-fix system" --body "$(cat <<'EOF'
Builds the data-anomaly audit + auto-fix system per docs/superpowers/specs/2026-06-08-data-anomaly-audit-design.md.

- `data_audit` ledger table (migration 0018) — idempotency.
- `lib/audit/anomalyRules.ts` — pure rule catalog (auditVenue): assumed_days_avoidable, homepage_sourced_hh, overlapping/duplicate/operating-hours/implausible. London fixtures.
- `lib/audit/computeCorrection.ts` — pure update/deactivate/insert diff.
- `audit:data` (scan + report + ledger + --emit-batches) and `audit:fix` (free re-fetch + reversible correction via audit_log; dry-run default, free default).
- Tests: test:anomaly-rules (hermetic, in CI) + test:audit-fix (rolled-back integration).
- Corrects the stored London Bar & Grill row to a single Mon–Fri 16:00–19:00 from /happy-hour/.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec coverage self-check

- **Detect named failure modes (rules):** Task 2 `anomalyRules.ts` — all six spec codes. ✓
- **Detect unnamed weirdness (in-session agent sniff-test):** Task 4 `--emit-batches` writes `docs/audit-batches/<city>-*.md` for this session/subagents to review (process, $0). The agent writes verdicts back via `data_audit.agent_verdict` — done in-session, not scripted. ✓
- **Fix by re-fetching own pages:** Task 5 `audit:fix` reuses the free triage/parse path; auto-applies high-confidence, reports the rest. ✓ (`--escalate-paid` is spec'd as opt-in/deferred — out of this plan's scope, noted below.)
- **Remember cleared venues (idempotent):** Task 1 `data_audit` + Task 4 skip-unless-`--recheck`. ✓
- **Never hard-delete; reversible:** Task 5/6 soft-deactivate + `audit_log` rows. ✓
- **London as regression fixture:** Task 2 (rule fixtures) + Task 6 (apply integration). ✓ (Operator chose "regression fixture only" — no separate golden-eval harness.)
- **Prereq A/B/C:** already on `origin/main` (PR #51/#52) — not re-done here. ✓

## Out of scope (per spec)

- `--escalate-paid` paid-model re-extraction (deferred; free-only fixer here).
- Venue-metadata audits beyond HH windows.
- A recurring cron (operator-run CLI for now).
- Auto-resolving overlap to a "winner" (reconcile hides for review; the fixer only corrects when the re-parse is unambiguous and high-confidence).
