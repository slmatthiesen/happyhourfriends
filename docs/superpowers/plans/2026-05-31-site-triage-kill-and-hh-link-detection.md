# Site Triage — Kill Dead Listings + Follow HH-Signal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the seed pipeline from creating venues for dead/parked/no-site listings (kill them, with a reviewable audit report), and lift extractor recall by pointing it at a venue's own happy-hour/menu links.

**Architecture:** Two new pure modules — `hhLikelihood` (venue-type → P(HH) prior) and `siteTriage` (classify URL, probe reachability, scan for HH-signal links) — plus a `killReport` markdown formatter. The enrich pipeline and a new retroactive script both consume these. We kill **only** on an invalid *site*; a valid site with no extractable times stays a stub (recall-gap safety net per `project_extractor_misses_all_day_specials`).

**Tech Stack:** TypeScript (strict), `tsx` scripts, postgres.js, Drizzle ORM + drizzle-kit (generated migrations), Anthropic SDK (server-side `web_fetch`/`web_search`). Tests are runnable `tsx scripts/test-*.ts` files using `node:assert/strict` (no test framework in repo).

**Spec:** `docs/superpowers/specs/2026-05-31-site-triage-kill-and-hh-link-detection-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/places/hhLikelihood.ts` *(new)* | Pure venue-type → P(HH) prior, keyed on Google primaryType → types[] → VenueType → name keywords. |
| `scripts/test-hh-likelihood.ts` *(new)* | Runnable unit checks for the prior. |
| `lib/places/siteTriage.ts` *(new)* | Pure helpers (`classifyUrl`, `isParkedHtml`, `extractHhSignalLinks`, `resolveEnrichAction`) + network orchestrator `triageSite`. |
| `scripts/test-site-triage.ts` *(new)* | Runnable unit checks for the pure helpers. |
| `lib/places/killReport.ts` *(new)* | Pure markdown formatter for a list of killed/triaged venues. |
| `scripts/test-kill-report.ts` *(new)* | Runnable unit checks for the formatter. |
| `lib/ai/extractHappyHours.ts` *(modify)* | Add optional `priorityUrls` to `ExtractInput` + render into the request. |
| `lib/ai/enrichBatchState.ts` *(modify)* | Add optional `priorityUrls` to `PrepContext` so HH links survive the batch round-trip. |
| `prompts/seed-extract-hh.md` *(modify)* | Add `{{priority_urls}}` placeholder; bump version to 9. |
| `db/schema/enums.ts` *(modify)* | Add `killed_no_site` to `seed_outcome` enum. |
| `db/migrations/0011_*.sql` *(generated)* | Drizzle-generated enum migration. |
| `scripts/seed-enrich-candidates.ts` *(modify)* | Triage-driven decision matrix (on-demand + batch paths); kill handling; report. |
| `scripts/triage-stub-sites.ts` *(new)* | Retroactive cleanup pass (dry-run default, `--apply`). |
| `package.json` *(modify)* | `triage:stubs` script entry. |

---

## Task 1: HH-likelihood model

**Files:**
- Create: `lib/places/hhLikelihood.ts`
- Test: `scripts/test-hh-likelihood.ts`

The doc `docs/phoenix-stub-hh-review.md` derived likelihood from Google **primaryType** (per-cuisine), so the model keys there first. `deriveVenueType` collapses every `*_restaurant` to `restaurant`, so it is only a coarse fallback. Numbers are tunable priors (operator may adjust); the only behaviorally-load-bearing line is the 0.5 gate used in Task 6.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-hh-likelihood.ts`:

```ts
/**
 * Runnable unit checks for hhLikelihood (no test framework in repo).
 * Run: npx tsx scripts/test-hh-likelihood.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { hhLikelihood } from "@/lib/places/hhLikelihood";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// primaryType drives the score (per-cuisine, matching the review doc)
check("sports_bar is high", () =>
  assert.ok((hhLikelihood({ primaryType: "sports_bar" }) ?? 0) > 0.5));
check("bar is high", () =>
  assert.ok((hhLikelihood({ primaryType: "bar" }) ?? 0) > 0.5));
check("brewery is high", () =>
  assert.ok((hhLikelihood({ primaryType: "brewery" }) ?? 0) > 0.5));
check("american_restaurant is high", () =>
  assert.ok((hhLikelihood({ primaryType: "american_restaurant" }) ?? 0) > 0.5));
check("italian_restaurant is high", () =>
  assert.ok((hhLikelihood({ primaryType: "italian_restaurant" }) ?? 0) > 0.5));
check("mexican_restaurant is mid (not >0.5)", () => {
  const v = hhLikelihood({ primaryType: "mexican_restaurant" }) ?? 0;
  assert.ok(v > 0 && v <= 0.5);
});
check("chinese_restaurant is low", () =>
  assert.ok((hhLikelihood({ primaryType: "chinese_restaurant" }) ?? 1) < 0.1));
check("thai_restaurant is ~0", () =>
  assert.equal(hhLikelihood({ primaryType: "thai_restaurant" }), 0));
check("seafood_restaurant is low", () =>
  assert.ok((hhLikelihood({ primaryType: "seafood_restaurant" }) ?? 1) < 0.1));

// types[] fallback when primaryType is null
check("types[] sports_bar wins when primaryType null", () =>
  assert.ok((hhLikelihood({ primaryType: null, types: ["point_of_interest", "sports_bar"] }) ?? 0) > 0.5));

// name-keyword floor lifts an otherwise-generic restaurant
check("name 'Cantina' floors a generic restaurant above 0.5", () =>
  assert.ok((hhLikelihood({ primaryType: "restaurant", name: "Ojos Locos Sports Cantina" }) ?? 0) > 0.5));

// genuinely unknown → null (treated as below-threshold by the gate)
check("no signal at all → null", () =>
  assert.equal(hhLikelihood({ primaryType: null, types: null, name: null }), null));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-hh-likelihood.ts`
Expected: FAIL — `Cannot find module '@/lib/places/hhLikelihood'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/places/hhLikelihood.ts`:

```ts
/**
 * hhLikelihood — prior probability a venue runs a happy hour, by type.
 *
 * Reconstructs the per-cuisine priors that drove docs/phoenix-stub-hh-review.md
 * (the original generator was ad-hoc and never committed). Keyed on Google
 * primaryType first (per-cuisine), then types[], then the coarse VenueType, then
 * name keywords. Pure, no I/O. The numbers are tunable priors; the only
 * behaviorally load-bearing consumer is the >0.5 no-site rescue gate (enrich pipeline).
 */
import { deriveVenueType, type VenueType } from "@/lib/places/venueType";

// Google primaryType → prior. Values approximated from the Phoenix review doc.
const PRIMARY_TYPE_PRIOR: Record<string, number> = {
  sports_bar: 0.62,
  bar: 0.61,
  pub: 0.58,
  irish_pub: 0.58,
  gastropub: 0.58,
  brewery: 0.56,
  brewpub: 0.56,
  wine_bar: 0.41,
  cocktail_bar: 0.29,
  lounge_bar: 0.29,
  night_club: 0.33,
  american_restaurant: 0.57,
  new_american_restaurant: 0.57,
  italian_restaurant: 0.56,
  bar_and_grill: 0.5,
  restaurant: 0.45,
  pizza_restaurant: 0.32,
  mexican_restaurant: 0.33,
  latin_american_restaurant: 0.33,
  steak_house: 0.2,
  sushi_restaurant: 0.19,
  japanese_restaurant: 0.19,
  ramen_restaurant: 0.17,
  barbecue_restaurant: 0.14,
  chinese_restaurant: 0.08,
  seafood_restaurant: 0.07,
  thai_restaurant: 0.0,
  vegan_restaurant: 0.0,
  vegetarian_restaurant: 0.0,
  indian_restaurant: 0.0,
  cafe: 0.0,
  coffee_shop: 0.0,
  bakery: 0.0,
};

// Coarse fallback when only the collapsed VenueType is known.
const VENUE_TYPE_PRIOR: Partial<Record<VenueType, number>> = {
  sports_bar: 0.62,
  bar: 0.6,
  pub: 0.58,
  dive_bar: 0.5,
  wine_bar: 0.41,
  brewery: 0.56,
  tasting_room: 0.4,
  cocktail_lounge: 0.35,
  gastropub: 0.58,
  club: 0.33,
  hotel_bar: 0.5,
  pizzeria: 0.32,
  cafe: 0.0,
  restaurant: 0.4,
  // `other` intentionally omitted → null
};

// Name keywords that set a FLOOR on the prior (a "Sports Cantina" is HH-likely
// regardless of how Google typed it).
const NAME_FLOORS: Array<[RegExp, number]> = [
  [/\b(sports?\s*bar|cantina|tavern|ale\s*house|brew(ery|pub|ing)?|saloon)\b/i, 0.58],
  [/\b(bar\s*(&|and)\s*grill|grill(e)?|pub|gastropub)\b/i, 0.55],
  [/\b(cocktail|lounge|wine\s*bar)\b/i, 0.41],
];

export function hhLikelihood(input: {
  venueType?: VenueType | null;
  primaryType?: string | null;
  types?: string[] | null;
  name?: string | null;
}): number | null {
  let score: number | null = null;

  const pt = input.primaryType?.toLowerCase();
  if (pt && pt in PRIMARY_TYPE_PRIOR) score = PRIMARY_TYPE_PRIOR[pt];

  if (score === null && input.types) {
    for (const t of input.types) {
      const key = t.toLowerCase();
      if (key in PRIMARY_TYPE_PRIOR) {
        score = PRIMARY_TYPE_PRIOR[key];
        break;
      }
    }
  }

  if (score === null) {
    // Collapse to coarse VenueType (uses the same derivation as the pipeline).
    const vt =
      input.venueType ??
      deriveVenueType({
        primaryType: input.primaryType ?? null,
        types: input.types ?? null,
        name: input.name ?? "",
      });
    if (vt in VENUE_TYPE_PRIOR) score = VENUE_TYPE_PRIOR[vt] ?? null;
  }

  // Name-keyword floor — can lift a generic match, but never invents a score
  // from nothing (only applies when we already have some signal OR a name match).
  if (input.name) {
    for (const [re, floor] of NAME_FLOORS) {
      if (re.test(input.name)) {
        score = Math.max(score ?? 0, floor);
        break;
      }
    }
  }

  return score === null ? null : Math.min(1, Math.max(0, score));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-hh-likelihood.ts`
Expected: PASS — `12 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/places/hhLikelihood.ts scripts/test-hh-likelihood.ts
git commit -m "feat(triage): HH-likelihood venue-type prior + checks"
```

---

## Task 2: Site triage module

**Files:**
- Create: `lib/places/siteTriage.ts`
- Test: `scripts/test-site-triage.ts`

Pure helpers are unit-tested with fixture strings (no fetch mocking needed). The network orchestrator `triageSite` composes them and is exercised manually in Task 8.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-site-triage.ts`:

```ts
/**
 * Runnable unit checks for siteTriage pure helpers (no test framework in repo).
 * Run: npx tsx scripts/test-site-triage.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  classifyUrl,
  isParkedHtml,
  extractHhSignalLinks,
  resolveEnrichAction,
  type SiteVerdict,
} from "@/lib/places/siteTriage";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// classifyUrl
check("empty → none", () => assert.equal(classifyUrl(null).kind, "none"));
check("facebook → social_only", () =>
  assert.equal(classifyUrl("https://www.facebook.com/obriens").kind, "social_only"));
check("linktree → social_only", () =>
  assert.equal(classifyUrl("https://linktr.ee/unostacosaz").kind, "social_only"));
check("doordash → social_only", () =>
  assert.equal(classifyUrl("https://www.doordash.com/store/x").kind, "social_only"));
check("real domain → real", () => {
  const c = classifyUrl("http://brixphoenix.com/");
  assert.equal(c.kind, "real");
  assert.equal(c.url, "http://brixphoenix.com/");
});

// isParkedHtml
check("for-sale page is parked", () =>
  assert.equal(isParkedHtml('<title>brix.com is for sale</title><body>Buy this domain</body>', "http://x.com"), true));
check("real menu page is not parked", () =>
  assert.equal(isParkedHtml("<body><nav><a href='/happy-hour'>Happy Hour</a></nav> lots of real content here ".repeat(20) + "</body>", "http://x.com"), false));

// extractHhSignalLinks
check("finds /happy-hour link, resolved absolute", () => {
  const links = extractHhSignalLinks('<a href="/happy-hour">HH</a><a href="/about">About</a>', "https://brix.com/");
  assert.deepEqual(links, ["https://brix.com/happy-hour"]);
});
check("finds drink menu + dedupes", () => {
  const links = extractHhSignalLinks(
    '<a href="/drink-menu">Drinks</a><a href="/drink-menu">Drinks</a><a href="/menus">Menus</a>',
    "https://x.com/",
  );
  assert.deepEqual(links.sort(), ["https://x.com/drink-menu", "https://x.com/menus"]);
});
check("anchor text 'Happy Hour' counts even with opaque href", () => {
  const links = extractHhSignalLinks('<a href="/p/123">Happy Hour Specials</a>', "https://x.com/");
  assert.deepEqual(links, ["https://x.com/p/123"]);
});

// resolveEnrichAction — the decision matrix
const real = (r: "ok" | "dead" | "parked", hh: string[] = []): SiteVerdict => ({
  kind: "real", url: "http://x.com", reachability: r, hhSignalUrls: hh,
  decision: r === "ok" ? "extract" : "kill", reason: r,
});
check("real+ok → extract", () =>
  assert.equal(resolveEnrichAction(real("ok"), 0.6).action, "extract"));
check("real+dead → kill", () =>
  assert.equal(resolveEnrichAction(real("dead"), 0.9).action, "kill"));
check("real+parked → kill", () =>
  assert.equal(resolveEnrichAction(real("parked"), 0.9).action, "kill"));
check("social_only → stub", () =>
  assert.equal(resolveEnrichAction(
    { kind: "social_only", url: "http://fb", reachability: null, hhSignalUrls: [], decision: "stub", reason: "social" }, 0.9
  ).action, "stub"));
check("no-site, likelihood>0.5 → extract (go for it)", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, 0.62
  ).action, "extract"));
check("no-site, likelihood<=0.5 → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, 0.33
  ).action, "kill"));
check("no-site, likelihood null → kill", () =>
  assert.equal(resolveEnrichAction(
    { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" }, null
  ).action, "kill"));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-site-triage.ts`
Expected: FAIL — `Cannot find module '@/lib/places/siteTriage'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/places/siteTriage.ts`:

```ts
/**
 * siteTriage — classify a candidate's web presence so the enrich pipeline can
 * KILL dead/parked/no-site listings (instead of stubbing them) and POINT the
 * extractor at a venue's own happy-hour/menu links.
 *
 * Pure helpers (classifyUrl / isParkedHtml / extractHhSignalLinks /
 * resolveEnrichAction) are unit-tested. triageSite is the network orchestrator
 * (plain Node fetch — NOT a Claude tool, so it is allowed in a tsx script).
 *
 * SACRED: we kill only on an invalid SITE. A reachable site with no extractable
 * times stays a stub — that is the extractor-recall-gap safety net.
 */

export type SiteKind = "real" | "social_only" | "none";
export type Reachability = "ok" | "dead" | "parked";

export interface SiteVerdict {
  kind: SiteKind;
  url: string | null;
  reachability: Reachability | null;
  hhSignalUrls: string[];
  decision: "extract" | "stub" | "kill";
  reason: string;
}

// Hosts that are social/ordering presences, not a real first-party site. Keep as
// stubs (valid crowdsource targets) — never kill, never treat as extractable.
const SOCIAL_OR_ORDERING_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linktr.ee",
  "linktree",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "toasttab.com",
  "spoton.com",
  "orders.co",
  "order.spoton.com",
  "mobile-webview",
  "square.site",
  "rebrand.ly",
];

const PARKED_MARKERS = [
  "is for sale",
  "buy this domain",
  "domain for sale",
  "this domain is parked",
  "sedoparking",
  "bodis.com",
  "domain is currently available",
  "godaddy.com/domainsearch",
];

// href substrings / anchor-text patterns that signal a happy-hour or menu page.
const HH_LINK_PATTERNS = [
  /happy[-_ ]?hour/i,
  /specials?/i,
  /(beer|drink|cocktail|wine|food)[-_ ]?menu/i,
  /\/menus?\b/i,
];

export function classifyUrl(raw: string | null | undefined): { kind: SiteKind; url: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) return { kind: "none", url: null };
  let host = trimmed.toLowerCase();
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    /* unparseable — fall through to substring check */
  }
  if (SOCIAL_OR_ORDERING_HOSTS.some((h) => host.includes(h))) {
    return { kind: "social_only", url: trimmed };
  }
  return { kind: "real", url: trimmed };
}

export function isParkedHtml(html: string, _finalUrl: string): boolean {
  const lower = html.toLowerCase();
  if (PARKED_MARKERS.some((m) => lower.includes(m))) return true;
  // Near-empty body (strip tags) → placeholder shell.
  const text = lower.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length < 80;
}

export function extractHhSignalLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ");
    const hit = HH_LINK_PATTERNS.some((re) => re.test(href) || re.test(text));
    if (!hit) continue;
    try {
      out.add(new URL(href, baseUrl).toString());
    } catch {
      /* skip unresolvable href */
    }
    if (out.size >= 5) break;
  }
  return [...out];
}

/** Combine a triage verdict with the venue's HH-likelihood into a final action. */
export function resolveEnrichAction(
  verdict: SiteVerdict,
  likelihood: number | null,
): { action: "extract" | "stub" | "kill"; reason: string; priorityUrls: string[] } {
  // No real site on file, but the venue type is promising → "go for it":
  // let the extractor's web_search try to find the site before we give up.
  if (verdict.kind === "none" && likelihood != null && likelihood > 0.5) {
    return { action: "extract", reason: "no site on file but likely HH (>50%)", priorityUrls: [] };
  }
  return { action: verdict.decision, reason: verdict.reason, priorityUrls: verdict.hhSignalUrls };
}

async function fetchHtml(url: string, ms = 5000): Promise<{ status: number; html: string; finalUrl: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" },
    });
    const html = await res.text();
    return { status: res.status, html, finalUrl: res.url || url };
  } catch {
    return null; // DNS fail / refused / timeout / abort
  } finally {
    clearTimeout(timer);
  }
}

export async function triageSite(input: {
  websiteUri: string | null;
  name: string;
  cityName: string | null;
}): Promise<SiteVerdict> {
  const cls = classifyUrl(input.websiteUri);
  if (cls.kind === "none") {
    return { kind: "none", url: null, reachability: null, hhSignalUrls: [], decision: "kill", reason: "no site on file" };
  }
  if (cls.kind === "social_only") {
    return { kind: "social_only", url: cls.url, reachability: null, hhSignalUrls: [], decision: "stub", reason: "social/ordering link only" };
  }

  const resp = await fetchHtml(cls.url!);
  if (!resp || resp.status >= 500 || (resp.status >= 404 && resp.status <= 410)) {
    return { kind: "real", url: cls.url, reachability: "dead", hhSignalUrls: [], decision: "kill", reason: `dead site (${resp ? resp.status : "unreachable"})` };
  }
  if (resp.status === 200 && isParkedHtml(resp.html, resp.finalUrl)) {
    return { kind: "real", url: cls.url, reachability: "parked", hhSignalUrls: [], decision: "kill", reason: "parked domain" };
  }
  // Reachable (incl. 403 bot-block) → extract; collect HH-signal links from the HTML we have.
  const hhSignalUrls = resp.status === 200 ? extractHhSignalLinks(resp.html, resp.finalUrl) : [];
  return { kind: "real", url: cls.url, reachability: "ok", hhSignalUrls, decision: "extract", reason: "reachable" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-site-triage.ts`
Expected: PASS — `19 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/places/siteTriage.ts scripts/test-site-triage.ts
git commit -m "feat(triage): site classification, reachability probe, HH-link scan"
```

---

## Task 3: Kill audit report formatter

**Files:**
- Create: `lib/places/killReport.ts`
- Test: `scripts/test-kill-report.ts`

A pure markdown formatter shared by the pipeline (append) and the retroactive script (full report). No I/O — the caller writes the file.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-kill-report.ts`:

```ts
/**
 * Runnable unit checks for killReport (no test framework in repo).
 * Run: npx tsx scripts/test-kill-report.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { renderKillReport, type KillEntry } from "@/lib/places/killReport";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const entries: KillEntry[] = [
  { name: "Dead Bar", neighborhood: "Alhambra", reason: "dead", urlTried: "http://dead.com", likelihood: 0.61 },
  { name: "Parked Pub", neighborhood: null, reason: "parked", urlTried: "http://parked.com", likelihood: 0.58 },
  { name: "American Way Pasta", neighborhood: "Ahwatukee", reason: "no_site", urlTried: null, likelihood: 0.56 },
];

check("groups dead/parked under one heading and no-site under another", () => {
  const md = renderKillReport("Phoenix", entries);
  assert.ok(md.includes("Killed: dead / parked sites (2)"));
  assert.ok(md.includes("No site on file — recognize any of these? (1)"));
});
check("renders a table row per entry with likelihood as %", () => {
  const md = renderKillReport("Phoenix", entries);
  assert.ok(md.includes("Dead Bar"));
  assert.ok(md.includes("61%"));
  assert.ok(md.includes("American Way Pasta"));
});
check("empty list still renders headings with (0)", () => {
  const md = renderKillReport("Phoenix", []);
  assert.ok(md.includes("(0)"));
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-kill-report.ts`
Expected: FAIL — `Cannot find module '@/lib/places/killReport'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/places/killReport.ts`:

```ts
/**
 * killReport — render a markdown audit of venues triaged for KILL, so the operator
 * can eyeball for false positives and rescue any they recognize. Pure; caller writes.
 */
export type KillReason = "dead" | "parked" | "no_site";

export interface KillEntry {
  name: string;
  neighborhood: string | null;
  reason: KillReason;
  urlTried: string | null;
  likelihood: number | null;
}

function pct(v: number | null): string {
  return v == null ? "?" : `${Math.round(v * 100)}%`;
}

function table(rows: KillEntry[], includeUrl: boolean): string {
  const head = includeUrl
    ? "| Venue | Neighborhood | Reason | URL tried | Likelihood |\n| --- | --- | --- | --- | --- |"
    : "| Venue | Neighborhood | Likelihood |\n| --- | --- | --- |";
  const body = rows
    .map((r) =>
      includeUrl
        ? `| ${r.name} | ${r.neighborhood ?? ""} | ${r.reason} | ${r.urlTried ?? ""} | ${pct(r.likelihood)} |`
        : `| ${r.name} | ${r.neighborhood ?? ""} | ${pct(r.likelihood)} |`,
    )
    .join("\n");
  return rows.length ? `${head}\n${body}` : "_none_";
}

export function renderKillReport(cityName: string, entries: KillEntry[]): string {
  const deadParked = entries.filter((e) => e.reason === "dead" || e.reason === "parked");
  const noSite = entries.filter((e) => e.reason === "no_site");
  return [
    `# ${cityName} — killed venues (site triage)`,
    "",
    "Venues we did NOT create/keep because no valid site was found. Review for false positives.",
    "",
    `## Killed: dead / parked sites (${deadParked.length})`,
    "",
    table(deadParked, true),
    "",
    `## No site on file — recognize any of these? (${noSite.length})`,
    "",
    "These had no real website on file (low HH-likelihood, so we did not auto-search). If you recognize one, add it via the normal submit flow.",
    "",
    table(noSite, false),
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-kill-report.ts`
Expected: PASS — `3 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/places/killReport.ts scripts/test-kill-report.ts
git commit -m "feat(triage): kill-audit markdown report formatter"
```

---

## Task 4: Extractor `priorityUrls` (recall)

**Files:**
- Modify: `lib/ai/extractHappyHours.ts` (`ExtractInput`, `fillPlaceholders`, JSDoc)
- Modify: `prompts/seed-extract-hh.md` (add `{{priority_urls}}`, bump version to 9)
- Test: `scripts/test-extract-request.ts` *(new)*

- [ ] **Step 1: Write the failing test**

Create `scripts/test-extract-request.ts`:

```ts
/**
 * Runnable check: buildExtractRequest renders priorityUrls into the user message.
 * Run: npx tsx scripts/test-extract-request.ts — exits non-zero on failure.
 */
import assert from "node:assert/strict";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

function userText(req: ReturnType<typeof buildExtractRequest>): string {
  const msg = req.params.messages[0];
  return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
}

check("priority urls are listed when provided", () => {
  const req = buildExtractRequest({
    venueName: "Brix", websiteUrl: "http://brix.com", otherUrl: null, cityName: "Phoenix",
    priorityUrls: ["http://brix.com/happy-hour", "http://brix.com/menus"],
  });
  const t = userText(req);
  assert.ok(t.includes("http://brix.com/happy-hour"));
  assert.ok(t.includes("http://brix.com/menus"));
});

check("renders 'none' when no priority urls", () => {
  const req = buildExtractRequest({ venueName: "Brix", websiteUrl: "http://brix.com", otherUrl: null, cityName: "Phoenix" });
  assert.ok(userText(req).toLowerCase().includes("none"));
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-extract-request.ts`
Expected: FAIL — assertion fails (priority URLs not present) or TS error on the unknown `priorityUrls` property.

- [ ] **Step 3: Add `priorityUrls` to the input + placeholder filler**

In `lib/ai/extractHappyHours.ts`, extend `ExtractInput` (after the `cityName` field, around line 42):

```ts
  /** City/locality name, used to scope the web_search fallback (e.g. "Phoenix"). */
  cityName?: string | null;
  /** Venue's own HH/menu pages found by site triage — fetch these FIRST. */
  priorityUrls?: string[];
```

Replace `fillPlaceholders` (around line 240) with:

```ts
function fillPlaceholders(template: string, input: ExtractInput): string {
  const priority =
    input.priorityUrls && input.priorityUrls.length > 0
      ? input.priorityUrls.map((u) => `- ${u}`).join("\n")
      : "none";
  return template
    .replace("{{venue_name}}", input.venueName)
    .replace("{{website_url}}", input.websiteUrl ?? "none")
    .replace("{{other_url}}", input.otherUrl ?? "none")
    .replace("{{priority_urls}}", priority)
    .replaceAll("{{city}}", input.cityName?.trim() || "");
}
```

- [ ] **Step 4: Add the placeholder to the prompt + bump version**

In `prompts/seed-extract-hh.md`, change the User section to:

```markdown
# User

Venue: {{venue_name}}
Venue website: {{website_url}}
Venue other URL: {{other_url}}

Known happy-hour / menu pages for this venue (fetch these FIRST, before the homepage):
{{priority_urls}}
```

Bump the frontmatter `version: 8` → `version: 9` and prepend to `notes:`:
`v9 — {{priority_urls}}: site triage hands the model the venue's own HH/menu links to fetch first; `

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-extract-request.ts`
Expected: PASS — `2 checks passed.`

- [ ] **Step 6: Commit**

```bash
git add lib/ai/extractHappyHours.ts prompts/seed-extract-hh.md scripts/test-extract-request.ts
git commit -m "feat(extract): priorityUrls — point the extractor at venue HH/menu pages"
```

---

## Task 5: Migration — `killed_no_site` seed_outcome

**Files:**
- Modify: `db/schema/enums.ts:172-177`
- Generate: `db/migrations/0011_*.sql`

- [ ] **Step 1: Add the enum value**

In `db/schema/enums.ts`, change the `seedOutcome` enum to:

```ts
export const seedOutcome = pgEnum("seed_outcome", [
  "confirmed_hh",
  "no_hh_found",
  "no_hh_explicit",
  "error",
  "killed_no_site",
]);
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `db/migrations/0011_*.sql` containing `ALTER TYPE "public"."seed_outcome" ADD VALUE 'killed_no_site';`

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: migration `0011` applied, no errors. (Requires Docker postgis up + `DATABASE_URL`.)

- [ ] **Step 4: Verify typecheck still clean**

Run: `npm run typecheck`
Expected: only the 2 pre-existing Phase 0 errors (`db/schema/moderation.ts`, `scripts/import-neighborhoods.ts`).

- [ ] **Step 5: Commit**

```bash
git add db/schema/enums.ts db/migrations/
git commit -m "feat(db): add killed_no_site to seed_outcome enum (migration 0011)"
```

---

## Task 6: Pipeline integration — on-demand decision matrix

**Files:**
- Modify: `scripts/seed-enrich-candidates.ts`

Wire triage into the on-demand loop: after the alcohol gate, run `triageSite`, compute `hhLikelihood`, `resolveEnrichAction`, and branch kill / stub / extract. Collect kill entries and write the report at the end. No new test script — this is I/O orchestration verified manually in Task 8 + by the unit-tested pure pieces it composes.

- [ ] **Step 1: Add imports**

At the top of `scripts/seed-enrich-candidates.ts`, alongside the other `@/lib/places` imports (around line 56-58), add:

```ts
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { renderKillReport, type KillEntry, type KillReason } from "@/lib/places/killReport";
import { writeFile } from "node:fs/promises";
```

- [ ] **Step 2: Extend the SeedOutcome type + add a kill-entry accumulator**

Change the `SeedOutcome` type (around line 102) to include the new value:

```ts
type SeedOutcome = "confirmed_hh" | "no_hh_explicit" | "no_hh_found" | "killed_no_site" | "error";
```

Add a helper near the top-level (after the `NoDataEntry` interface, ~line 111):

```ts
/** Map a triage kill reason string to the report's KillReason bucket. */
function killReasonOf(reason: string): KillReason {
  if (reason.startsWith("dead")) return "dead";
  if (reason.startsWith("parked")) return "parked";
  return "no_site";
}
```

- [ ] **Step 3: Replace the extract-or-stub block in the on-demand loop**

In `main()`, the on-demand loop currently (lines ~475-523) computes `siteUrl`, calls `extractHappyHours` when a site exists, then always `persistExtraction`. Replace from the `const siteUrl = ...` line through the end of the `try`'s persist/log block with:

```ts
        const siteUrl = details?.websiteUri ?? null;

        // ---- Site triage: kill dead/parked/no-site; point extractor at HH links --
        const verdict = await triageSite({
          websiteUri: siteUrl,
          name: candidate.name,
          cityName: city.name,
        });
        const likelihood = hhLikelihood({
          primaryType: candidate.primary_type,
          types: candidate.types,
          name: candidate.name,
        });
        const decided = resolveEnrichAction(verdict, likelihood);

        if (decided.action === "kill") {
          console.log(`  ✗ kill — ${decided.reason}`);
          killEntries.push({
            name: candidate.name,
            neighborhood: null,
            reason: killReasonOf(verdict.reason),
            urlTried: verdict.url,
            likelihood,
          });
          await markProcessed(sql, candidate.id, "killed_no_site", null);
          nKilled++;
          continue;
        }

        // extract: real reachable site (use HH links) OR no-site go-for-it (web_search).
        const extractUrl = verdict.kind === "real" ? verdict.url : null;
        const extracted =
          decided.action === "extract"
            ? await extractHappyHours({
                venueName: candidate.name,
                websiteUrl: extractUrl,
                otherUrl: null,
                cityName: city.name,
                priorityUrls: decided.priorityUrls,
              })
            : null; // action === "stub" (social_only): no AI, write a stub

        if (extracted) {
          await writeLedger(sql, city.id, month, extracted);
          console.log(
            `  → confidence=${extracted.confidence.toFixed(2)}, cost=${extracted.costCents}¢, ` +
              `${extracted.happyHours.length} window(s)`,
          );
        } else {
          console.log("  → stub (social/ordering link only)");
        }

        const ctx: PrepContext = {
          candidateId: candidate.id,
          name: candidate.name,
          address: candidate.address,
          lat: candidate.lat,
          lng: candidate.lng,
          googlePlaceId: candidate.google_place_id,
          siteUrl,
          phone: details?.phone ?? null,
          priceLevel: details?.priceLevel ?? null,
          photoName: details?.photoName ?? null,
          primaryType: candidate.primary_type ?? null,
          types: candidate.types ?? null,
        };
        const persisted = await persistExtraction(sql, {
          cityId: city.id,
          placesKey,
          ctx,
          extracted,
        });
        outcome = persisted.outcome;
        resultingVenueId = persisted.venueId;
        console.log(
          persisted.hasHH
            ? `  ✓ ${extracted!.happyHours.length} HH window(s) saved`
            : "  ◦ likely-HH stub kept (no times found — crowdsource)",
        );
```

- [ ] **Step 4: Declare the new counters + accumulator**

Where the loop counters are declared (around line 411-416, `let nConfirmed = 0; ...`), add:

```ts
    let nKilled = 0;
    const killEntries: KillEntry[] = [];
```

- [ ] **Step 5: Write the report after the loop**

The kill path in Step 3 increments `nKilled` and `continue`s, so killed candidates never reach the existing tally block (around line 549-551) — leave that tally exactly as-is (no change needed). Kills are counted only at the `continue`.

After `const assigned = await assignNeighborhoods(sql, city.id);` (around line 560), add:

```ts
    if (killEntries.length > 0) {
      const path = `docs/${city.slug}-killed-venues.md`;
      await writeFile(path, renderKillReport(city.name, killEntries), "utf8");
      console.log(`\n  ✗ killed ${killEntries.length} no-site/dead/parked venue(s) → ${path}`);
    }
```

Add `console.log(\`  killed (no valid site): ${nKilled}\`);` to the summary block (after the `no_hh_found` line, ~line 566).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only the 2 pre-existing Phase 0 errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-enrich-candidates.ts
git commit -m "feat(enrich): site-triage decision matrix in on-demand path + kill report"
```

---

## Task 7: Pipeline integration — batch path

**Files:**
- Modify: `scripts/seed-enrich-candidates.ts` (`prepAndSubmit`, `runBatch`, `ReportTally`, `finalize`)

The batch path runs non-AI gates in `prepAndSubmit` and AI in the batch. Triage belongs in prep (it's non-AI), so kills happen before submission and HH-signal links ride into the batch request via `priorityUrls`.

- [ ] **Step 1: Add killed accounting to ReportTally**

In `ReportTally` (around line 585-597) add:

```ts
  killed: number;
  killEntries: KillEntry[];
```

Initialize them in the `tally` literal inside `runBatch` (around line 606-618): `killed: 0,` and `killEntries: [],`.

- [ ] **Step 2: Carry priorityUrls on PrepContext**

In `lib/ai/enrichBatchState.ts`, add to the `PrepContext` interface an optional field:

```ts
  /** Venue's own HH/menu pages found by site triage — fetched first by the extractor. */
  priorityUrls?: string[];
```

- [ ] **Step 3: Triage inside prepAndSubmit**

In `prepAndSubmit`, after the alcohol gate (`if (details && !details.servesAlcohol) {...}` around line 823-827) and before building `ctx`, insert:

```ts
    const verdict = await triageSite({
      websiteUri: details?.websiteUri ?? null,
      name: c.name,
      cityName: city.name,
    });
    const likelihood = hhLikelihood({ primaryType: c.primary_type, types: c.types, name: c.name });
    const decided = resolveEnrichAction(verdict, likelihood);

    if (decided.action === "kill") {
      await markProcessed(sql, c.id, "killed_no_site", null);
      tally.killed++;
      tally.killEntries.push({
        name: c.name,
        neighborhood: null,
        reason: killReasonOf(verdict.reason),
        urlTried: verdict.url,
        likelihood,
      });
      continue;
    }
```

Leave the existing `ctx` literal's `siteUrl: details?.websiteUri ?? null` line UNCHANGED — we keep whatever URL Google had (incl. a Facebook link) stored on the stub venue. Only ADD a `priorityUrls` field to the `ctx` literal:

```ts
      priorityUrls: decided.priorityUrls,
```

(For real+ok this equals the real site URL; for a no-site go-for-it `ctx.siteUrl` is null and the extractor's web_search finds the site; for social_only we never reach the batch build — see Step 4.)

- [ ] **Step 4: Handle the social-only stub + no-site go-for-it in prep**

Replace the existing `if (!ctx.siteUrl) { ...write stub... }` block (around line 845-856). Extraction must be gated on the *action*, not on whether a URL exists: `social_only` is always a no-AI stub (even though it has a Facebook URL), while a no-site **go-for-it** (`action === "extract"`, `ctx.siteUrl` null) must still be batched so `web_search` runs. Replace with:

```ts
    // social_only → write a stub now, no AI (the FB/IG URL is still stored on the venue
    // via ctx.siteUrl). A no-site go-for-it (action extract) falls through to the batch.
    if (decided.action === "stub") {
      const persisted = await persistExtraction(sql, { cityId: city.id, placesKey, ctx, extracted: null });
      await markProcessed(sql, c.id, persisted.outcome, persisted.venueId);
      tally.stubs++;
      tally.noData.push({ name: c.name, reason: "no_website" });
      continue;
    }
```

- [ ] **Step 5: Pass priorityUrls into the batch request build**

Where the batch request is built (around line 858), change to include priority URLs:

```ts
    const built = buildExtractRequest({
      venueName: ctx.name,
      websiteUrl: ctx.siteUrl,
      otherUrl: null,
      cityName: city.name,
      priorityUrls: ctx.priorityUrls,
    });
```

- [ ] **Step 6: Write the kill report in finalize**

In `finalize` (around line 873), after computing `assigned`, add:

```ts
  if (tally.killEntries.length > 0) {
    const path = `docs/${city.slug}-killed-venues.md`;
    await writeFile(path, renderKillReport(city.name, tally.killEntries), "utf8");
    console.log(`\nKilled (no valid site): ${tally.killed} → ${path}`);
  }
```

(Also surface `tally.killed` in the printed summary near the `filtered`/`skipped` lines.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: only the 2 pre-existing Phase 0 errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/seed-enrich-candidates.ts lib/ai/enrichBatchState.ts
git commit -m "feat(enrich): site triage + priorityUrls in --batch path"
```

---

## Task 8: Retroactive cleanup script

**Files:**
- Create: `scripts/triage-stub-sites.ts`
- Modify: `package.json` (add `triage:stubs`)

Dry-run by default; `--apply` performs deletes + upgrades. Always writes the report.

- [ ] **Step 1: Write the script**

Create `scripts/triage-stub-sites.ts`:

```ts
/**
 * Retroactive site triage over EXISTING stub venues (PRD §7.3 cleanup).
 *
 * For each data_completeness='stub' venue in the city:
 *   - dead/parked/no-site → KILL (delete the venue) — GUARDED: only if it has no
 *     happy_hours, edit_submissions, flags, promotions, or audit_log references.
 *   - reachable + HH-signal links → re-extract pointed at those links; upgrade to
 *     'complete' if times now appear.
 *   - else → leave as a stub.
 *
 * Dry-run by default (report only). Pass --apply to perform deletes + upgrades.
 * Always writes docs/<city>-killed-venues.md.
 *
 * Usage: tsx scripts/triage-stub-sites.ts --city phoenix [--limit N] [--apply]
 * Env: DATABASE_URL (required), ANTHROPIC_API_KEY (for upgrades).
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { renderKillReport, type KillEntry, type KillReason } from "@/lib/places/killReport";
import { extractHappyHours } from "@/lib/ai/extractHappyHours";
import type { VenueType } from "@/lib/places/venueType";

function killReasonOf(reason: string): KillReason {
  if (reason.startsWith("dead")) return "dead";
  if (reason.startsWith("parked")) return "parked";
  return "no_site";
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  return { city: get("--city") ?? "tacoma", limit: get("--limit") ? parseInt(get("--limit")!, 10) : null, apply: a.includes("--apply") };
}

interface StubVenue {
  id: string; name: string; website_url: string | null; type: string | null;
  promotion_tier: string; neighborhood_name: string | null;
}

/**
 * Refuse to delete a stub that carries any human/community work. Note the real schema:
 * edit_submissions + community_flags key on (target_type='venue', target_id); audit_log
 * keys on (table_name='venues', row_id); "promotion" is a column on venues (checked by
 * the caller via promotion_tier), not a separate table.
 */
async function hasAttachments(sql: ReturnType<typeof postgres>, venueId: string): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`
    SELECT (
      (SELECT count(*) FROM happy_hours WHERE venue_id = ${venueId}) +
      (SELECT count(*) FROM edit_submissions WHERE target_type = 'venue' AND target_id = ${venueId}) +
      (SELECT count(*) FROM community_flags WHERE target_type = 'venue' AND target_id = ${venueId}) +
      (SELECT count(*) FROM audit_log WHERE table_name = 'venues' AND row_id = ${venueId})
    )::int AS n`;
  return (r?.n ?? 0) > 0;
}

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error("ERROR: DATABASE_URL not set."); process.exit(1); }
  const sql = postgres(dbUrl, { max: 1 });
  const mode = args.apply ? "APPLY" : "DRY-RUN";

  try {
    const [city] = await sql<{ id: string; slug: string; name: string }[]>`
      SELECT id, slug, name FROM cities WHERE slug = ${args.city}`;
    if (!city) throw new Error(`City '${args.city}' not found.`);

    const stubs = await sql<StubVenue[]>`
      SELECT v.id, v.name, v.website_url, v.type::text AS type,
             v.promotion_tier::text AS promotion_tier, n.name AS neighborhood_name
      FROM venues v
      LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
      WHERE v.city_id = ${city.id} AND v.data_completeness = 'stub'
      ORDER BY v.created_at ASC
      ${args.limit != null ? sql`LIMIT ${args.limit}` : sql``}`;

    console.log(`[${mode}] triaging ${stubs.length} stub(s) for '${city.slug}'…`);
    const killEntries: KillEntry[] = [];
    let killed = 0, upgraded = 0, kept = 0, guarded = 0;

    for (const [i, v] of stubs.entries()) {
      console.log(`[${i + 1}/${stubs.length}] ${v.name}…`);
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const likelihood = hhLikelihood({ venueType: (v.type as VenueType | null) ?? null, name: v.name });
      const decided = resolveEnrichAction(verdict, likelihood);

      if (decided.action === "kill") {
        if (v.promotion_tier !== "none" || (await hasAttachments(sql, v.id))) {
          console.log("  ↷ keep — has submissions/flags/HH/promotion/audit (not deletable)");
          guarded++; kept++;
          continue;
        }
        killEntries.push({ name: v.name, neighborhood: v.neighborhood_name, reason: killReasonOf(verdict.reason), urlTried: verdict.url, likelihood });
        if (args.apply) {
          await sql`DELETE FROM venues WHERE id = ${v.id}`;
          console.log(`  ✗ killed — ${decided.reason}`);
        } else {
          console.log(`  ✗ WOULD kill — ${decided.reason}`);
        }
        killed++;
        continue;
      }

      // Promising: reachable with HH-signal links → try to upgrade.
      if (decided.action === "extract" && decided.priorityUrls.length > 0) {
        if (!process.env.ANTHROPIC_API_KEY) { console.log("  ◦ promising (links found) but no API key — keep stub"); kept++; continue; }
        const extracted = await extractHappyHours({
          venueName: v.name, websiteUrl: verdict.url, otherUrl: null, cityName: city.name, priorityUrls: decided.priorityUrls,
        });
        if (extracted.happyHours.length > 0) {
          // Dry-run only logs the intent; Step 2 replaces this branch with the real
          // INSERT + data_completeness flip behind the `args.apply` guard.
          console.log(`  ✓ ${args.apply ? "upgrade" : "WOULD upgrade"} — ${extracted.happyHours.length} window(s)`);
          upgraded++;
        } else {
          console.log(`  ◦ keep stub — 0 windows found`);
          kept++;
        }
        continue;
      }

      console.log("  ◦ keep stub");
      kept++;
    }

    const path = `docs/${city.slug}-killed-venues.md`;
    await writeFile(path, renderKillReport(city.name, killEntries), "utf8");

    console.log(`\n── ${mode} complete ──`);
    console.log(`  killed:   ${killed}${args.apply ? "" : " (would)"}`);
    console.log(`  upgraded: ${upgraded}${args.apply ? "" : " (would)"}`);
    console.log(`  guarded (kept, has data): ${guarded}`);
    console.log(`  kept:     ${kept}`);
    console.log(`  report:   ${path}`);
    if (!args.apply) console.log(`\nRe-run with --apply to perform deletes + upgrades.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Wire the real upgrade write-path**

The dry-run prints what it WOULD do. To make `--apply` actually upgrade, export the existing writer from the enrich script OR inline the inserts. Simplest: move `persistExtraction` is non-trivial to import (it lives in the script). Instead, inline the minimal upgrade in the apply branch — flip completeness and insert HH/offerings:

```ts
        if (args.apply && extracted.happyHours.length > 0) {
          await sql`UPDATE venues SET data_completeness = 'complete', last_verified_at = now(), updated_at = now() WHERE id = ${v.id}`;
          for (const hh of extracted.happyHours) {
            const days = [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
            const [row] = await sql<{ id: string }[]>`
              INSERT INTO happy_hours (venue_id, days_of_week, all_day, start_time, end_time, location_within_venue, notes, active, source_url)
              VALUES (${v.id}, ${days}, ${hh.allDay}, ${hh.startTime}, ${hh.endTime}, ${hh.locationWithinVenue}::location_within_venue, ${hh.notes}, true, ${hh.sourceUrl})
              ON CONFLICT DO NOTHING RETURNING id`;
            if (!row) continue;
            for (const o of hh.offerings) {
              await sql`INSERT INTO offerings (happy_hour_id, kind, category, name, price_cents, original_price_cents, discount_cents, description, conditions, active, source_url)
                VALUES (${row.id}, ${o.kind}::offering_kind, ${o.category}::offering_category, ${o.name}, ${o.priceCents}, ${o.originalPriceCents}, ${o.discountCents}, ${o.description}, ${o.conditions}, true, ${o.sourceUrl})`;
            }
          }
          console.log(`  ✓ upgraded — ${extracted.happyHours.length} window(s)`);
          upgraded++;
        }
```

Replace the placeholder `WOULD upgrade` branch from Step 1 with this block.

- [ ] **Step 3: Add the package.json script**

In `package.json` scripts, after `"prune:empty-venues"`, add:

```json
    "triage:stubs": "tsx scripts/triage-stub-sites.ts",
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: only the 2 pre-existing Phase 0 errors.

- [ ] **Step 5: Manual dry-run (requires Docker postgis + DATABASE_URL)**

Run: `npm run triage:stubs -- --city phoenix --limit 10`
Expected: prints per-venue triage decisions; writes `docs/phoenix-killed-venues.md`; makes NO DB changes (dry-run). Eyeball the report for false positives before any `--apply`.

- [ ] **Step 6: Commit**

```bash
git add scripts/triage-stub-sites.ts package.json
git commit -m "feat(triage): retroactive triage:stubs script (dry-run default, --apply)"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run every triage unit-check script**

Run:
```bash
npx tsx scripts/test-hh-likelihood.ts && \
npx tsx scripts/test-site-triage.ts && \
npx tsx scripts/test-kill-report.ts && \
npx tsx scripts/test-extract-request.ts
```
Expected: each prints `N checks passed.` and exits 0.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: only the 2 pre-existing Phase 0 errors (`db/schema/moderation.ts`, `scripts/import-neighborhoods.ts`).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean except the 2 pre-existing Phase 0 lint issues.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles (the benign Turbopack NFT file-trace warning from the upload store is unrelated).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(triage): verification fixups"
```

---

## Notes for the implementer

- **Do not regress the safety net.** Only `dead` / `parked` / qualifying `no_site` get killed. A reachable site that yields zero windows is ALWAYS a stub.
- **Node `fetch` in `siteTriage` is allowed** — it's a script-level fetch, not a Claude `WebFetch`/`WebSearch` tool (see CLAUDE.md "Environment constraints"). Background subagents still cannot use the Claude web tools; this runs in the main `tsx` process.
- **Likelihood numbers are tunable.** Only the `> 0.5` gate is behaviorally load-bearing. If the operator re-tunes the doc's priors, update `PRIMARY_TYPE_PRIOR`.
- **Migration numbering:** confirm the next free number is `0011` at implementation time (another model's update may have landed); `npm run db:generate` assigns it automatically from the schema diff.
- **Report path** `docs/<city>-killed-venues.md` is overwritten per retroactive run and per batch finalize, and written fresh by the on-demand loop. It is a generated artifact; the operator reviews it, it is not hand-edited.
