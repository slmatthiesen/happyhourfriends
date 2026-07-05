# Runbook — audit an existing city

The recurring health cycle for a city that is already live. Deterministic: run the steps
in order; each is labeled **$0** (free, deterministic) or **$-gated** (paid — quote first,
combined in-flight spend holds at the $5 gate). Supersedes the old
`all-cities-audit-runbook.md` + the audit half of `OPERATOR-CHEATSHEET.md` (both archived
under `docs/audits/archive/`).

> One of the two operator runbooks. The other is `docs/runbook-onboard-city.md`
> (nothing → live). Index: `docs/OPERATIONS.md`.

Cadence: run per city after any extractor/gate change lands, after a heal batch, or
roughly monthly. `pnpm doctor` (no args) sweeps every live city at once — start there and
work the FAILs.

**Prereqs:** local docker DB up (`docker compose up -d`). Every city-targeting command
takes `--city <slug> --state <code>`. Never hand-patch a venue — a misextraction means fix
the extractor/gate, then re-run it (`docs/OPERATIONS.md` → never-do list).

---

## Step 0 — Doctor ($0)

```bash
pnpm doctor                                    # all live cities — the entry point
pnpm doctor -- --city <slug> --state <code>    # one city
```

One row per city; every FAIL prints the step that fixes it. FAILs are structural
(neighborhood coverage <95%, zero polygons, recall never swept). WARNs are workload
(bare windows, junk offerings, unreviewed flags) — healed in the steps below. A high
stub % alone is NOT a problem to fix with spend; it's the crowdsource surface.

## Step 1 — Window reconcile ($0)

```bash
pnpm reconcile:windows -- --city <slug> --state <code>          # dry-run: merge/hide counts
pnpm reconcile:windows -- --city <slug> --state <code> --apply
```

Merges duplicate-day windows (unions days, soft-deletes the rest) and hides
operating-hours / overlap conflicts. Usually a no-op (the same gate fires at persist
time); run it first so later audits don't re-flag what it would have fixed.

## Step 2 — Regate ($0, mandatory after any gate change)

```bash
pnpm regate -- --city <slug> --state <code>            # report
pnpm regate -- --city <slug> --state <code> --apply
```

`active` is STORED at persist time — a window persisted before a gate improvement keeps
its old verdict until regate re-evaluates it (it once benched 5 real HHs in San Mateo).
Writes `docs/regate-<date>.{md,csv}`; archive these after review.

## Step 3 — Anomaly + provenance audit ($0)

```bash
pnpm audit:data -- --city <slug> --state <code>    # flags → data_audit → /admin/flags
pnpm audit:provenance                              # ALL cities → report → edit actions → --apply
```

`audit:data` catches duplicate/overlapping/implausible windows, operating-hours
masquerade, homepage-sourced HH. `audit:provenance` catches windows whose source URL
isn't the venue's own site (first-party violation — default action is hide; you only
edit the false-positive keepers).

## Step 4 — Content quality ($0)

```bash
pnpm audit:weak-offerings -- --city <slug> --state <code>   # deal-only names, bare windows, time anomalies, event sources
pnpm clean:junk-offerings -- --city <slug> --state <code>   # heal the junk-name tier
pnpm backfill:offering-names                                # $0 sanitize re-run after extractor changes
```

## Step 5 — Stub-junk curation ($0)

A city page with 50 live venues and 200 "needs info" stubs looks broken; many are junk
(dead site, no alcohol, no realistic HH). Quality bar is STRICT — drop = no-live-HH stub
AND (no alcohol evidence OR dead site):

```bash
pnpm cleanup:stubs -- --city <slug> --state <code>     # tiered report (keep/hide/delete) → edit → --apply
pnpm gate:stub-sites -- --city <slug> --state <code>   # hides no-alcohol/dead-site stubs; never touches published HH
```

Hide is reversible (`active=false` / hidden status); deletes never resurrect. When in
doubt, hide.

## Step 6 — Hidden-window review ($0 — run with EVERY heal)

```bash
pnpm review:hidden        # all cities → report → edit → apply
```

Roughly doubled Santa Cruz's live yield for $0 (2026-07-04). Don't read top-to-bottom —
triage where the default suggestion is most likely wrong: (a) suggested-delete evening
windows with offerings = rescue; (b) kept-hidden windows whose own source says "happy
hour" with deals = promote. A venue's own `/happy-hour` page is the top signal — the
right action is usually re-extract from that URL, not promoting the junk hidden row.
11:00–14:00 windows are lunch menus, not HH. Aggregator-sourced rows are never promoted.

## Step 7 — Free stub fill, then paid heal ($0 → $-gated)

```bash
pnpm reextract:stubs:free -- --city <slug> --state <code>           # $0 dry-run
pnpm reextract:stubs:free -- --city <slug> --state <code> --apply   # $0 deterministic fill
pnpm spotcheck:free -- --city <slug> --state <code>                 # $0 eyeball every live window + evidence

# PAID — quote first, $5 combined gate, always batch:
pnpm audit:bare-windows -- --city <slug> --state <code>             # $0 detector; cost ≈ $0.015 × count
pnpm reextract:stubs -- --city <slug> --state <code> --bare         # batch heal of dropped-deal windows
pnpm reextract:stubs -- --city <slug> --state <code> --dry-run      # paid-escalation triage ($0 to preview)
```

Diagnose a single stubborn venue for free first: `pnpm scan:hh-signal`,
`pnpm diagnose:no-hh`, then `pnpm debug:extract -- --url … --name …` (one ~5¢ call).

## Step 8 — Social-list diff (when a Reddit/FB thread surfaces)

Full decision procedure: `docs/social-list-coverage-audit.md`. Summary: fetch the thread
(`pnpm fetch:reddit <url>` — main thread only, headless Chrome), build the unique
venue-name list, diff per venue against `venues` + `seed_candidates`, and bucket every
miss: (a) out-of-boundary → expand boundary; (b) in-boundary recall miss → adaptive
recall **to completion** (`--hh-recall-only`, then `--resume-recall` until swept);
(c) stub/extraction miss → re-extract; (d) wrong Google entity → reseed;
(e) no-Google-HH-association → crowdsource residual, do NOT chase with spend.
Decide the fix from the category MIX — never blanket-run a lever.

## Step 9 — Push curation to prod ($0, SSM)

```bash
pnpm push:prod              # preview
pnpm push:prod -- --apply   # commit — additive + republish-changed; prod-newer venues skipped
```

---

## Spend gates (apply to every paid step)

- Quote the COMBINED total of all in-flight paid jobs before starting; proceed <$5,
  STOP ≥$5 and get sign-off. The AI ledger spans sessions (`pnpm ai:spend`).
- Enrich/re-extract is ALWAYS `--batch` (~50% cheaper) unless explicitly OK'd otherwise.
- Google discovery is PAID with NO local ledger — discovery runs ONCE per city, ever.
  Recall (`--hh-recall-only`) is the cheap idempotent exception (~$0.12–1.20/city).
