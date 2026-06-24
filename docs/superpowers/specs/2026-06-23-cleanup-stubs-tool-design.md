# Stub cleanup tool — design (2026-06-23)

## Problem

The public site shows ~50 live venues vs ~250 help-wanted stubs. That ratio reads as
empty/broken. Many stubs are low-value: no website, dead site, or a plain restaurant with
no alcohol evidence and no happy hour — largely the residue of the broad `"restaurant"`
discovery census (the part the recall-primary decision, backlog #3, is replacing). We want
a single tool to trim the stub list down to the ones worth keeping as a crowdsource bet,
without destroying recoverable data.

This tool cleans the **existing** backlog. It does **not** change discovery going forward
(recall-primary, backlog #3) — it unblocks that as a separate piece of work.

## Goal

One tunable, `$0`-by-default curation pass that classifies every no-HH stub into
**keep / hide / delete**, reusing the predicates and write paths already in the repo, with
a dry-run report rich enough to choose the policy before writing anything.

## Disposition model (tiered, decided)

- **Keep** — stays visible as a help-wanted stub.
- **Hide** — reversible: `venues.status = 'no_happy_hour'`. Dropped from the public list
  *and* the stub count (`lib/queries/venues.ts` excludes that status). The persist/apply
  path auto-flips it back to `'active'` the instant an active happy hour lands (Jina
  recovery, regate, crowdsource), so suppression never traps data.
- **Delete** — soft-delete: `venues.deleted_at = now()`, active happy_hours deactivated.
  `google_place_id` row survives as the re-discovery guard. Reserved for true junk only.

## Population

Same shape as `scripts/suppress-dead-end-stubs.ts`:

- non-deleted, `status = 'active'` venues
- with **no** active, non-deleted happy hour
- left-joined to `seed_candidates` (by `google_place_id`) for the alcohol/type signal
- plus `website_url` + `site_health` from the venue row
- `--city <slug> --state <code>` optional (all-cities default), via `requireCityArgs`.

Never touches live venues, operator `closed`/`paused` rows, or already-deleted rows.

## Per-venue signals (all `$0`, reuse existing code)

- `alcoholPositive` = `hasAlcoholSignal(name, primaryType, types)`
  (`lib/places/chainDenylist`) — positive bar/pub/brewery/lounge evidence by type or name.
  This is the crowdsource-bet test (bars seeded url-less are deliberately kept).
- `menuPlatformOnly` = `isMenuPlatformWebsite(website_url)` (`lib/places/menuPlatform`).
- `zeroHhType` = `primaryType ∈ ZERO_HH_TYPES` (`lib/places/stubGate` — korean/viet/chinese).
- `hasSite` = `website_url` present.
- `deadSite` = `site_health ∈ {dns_dead, unreachable, http_error, parked, expired_cert,
  invalid_cert}`. `blocked` (bot-wall) counts as **alive**. `site_health = null` (never
  probed) counts as **present-but-unverified = alive** (conservative — unprobed sites hide,
  never delete).

## Classification ladder (first match wins)

1. **DELETE** — `menuPlatformOnly` **OR** (`!alcoholPositive` AND (`!hasSite` OR `deadSite`)).
   The genuine junk: a menu-platform-only listing, or a no-alcohol restaurant with no
   working site to ever crowdsource or extract from.
2. **KEEP** — `alcoholPositive`. The crowdsource bet; always visible.
3. **HIDE** — `zeroHhType` (reversible). Hard delete of these stays in the dedicated
   `delete-empty-cuisine-stubs.ts`, run deliberately after recovery.
4. **KEEP / HIDE (policy-dependent)** — restaurant with a working site (not dead, not
   menu-platform, not zero-HH cuisine, no alcohol evidence): could be a recall miss worth
   crowdsourcing.
   - `--policy alcohol-or-site` (**default**): **KEEP** visible.
   - `--policy alcohol-only`: **HIDE** (reversible — revives if HH ever lands).
5. **HIDE** — anything else left over.

The **delete set is policy-independent**. Tightening the policy only moves good-site
restaurants from keep → hide, never to delete.

## CLI

```
pnpm cleanup:stubs [--city <slug> --state <code>] [--policy alcohol-or-site|alcohol-only]
                   [--refresh-sites] [--verbose] [--apply]
```

- **Dry-run (default, no writes):** per-city table of `keep N / hide N / delete N`, then a
  breakdown by reason. Prints **both policies' hide counts side by side** so the `#1` delta
  over the default `#2` is visible without a second run. `--verbose` lists venues per bucket
  (city / name / type / site / reason), like `docs/url-less-stubs-review-2026-06-23.md`.
- **`--apply`:** one transaction — `UPDATE … deleted_at` for the delete bucket (+ deactivate
  any active HH), `UPDATE … status='no_happy_hour'` for the hide bucket (guarded
  `AND status='active'`). Every changed row audit-logged (`audit_log`, actor `'script'`,
  reason string). Idempotent and re-runnable.
- **`--refresh-sites`:** runs the existing `audit:venue-sites --persist` probe first so
  `site_health` is current — improves precision of the `deadSite` delete test. Optional;
  without it, unprobed sites are treated as alive.

Default policy is `alcohol-or-site` (start gentle, tighten to `alcohol-only` if it doesn't
remove much — the report shows the delta).

## Reuse / no new logic

- Predicates: `hasAlcoholSignal`, `isMenuPlatformWebsite`, `ZERO_HH_TYPES` — imported, not
  reimplemented. The dead-end JUDGEMENT stays in JS so the rule has one home.
- Write/audit pattern: copied from `suppress-dead-end-stubs.ts` (hide) and
  `drop-menu-platform-stubs.ts` (delete) — same `audit_log` insert, same transaction shape.
- Reversibility hook: existing `lib/apply/engine.ts` already flips `no_happy_hour → active`
  on HH insert; nothing new needed.

## Non-goals

- Recall-primary discovery change (backlog #3) — separate go-forward work this unblocks.
- Curated non-venue removals — stay in `remove-venues.ts`, not duplicated here.
- An admin review UI — the dry-run report gives the eyeball; a `/admin/stub-cleanup` page
  can be added later if per-venue borderline review is needed.
- Prod deploy — operator handles deploys; this writes LOCAL, then publishes per existing
  flow.

## Testing

- Unit test the classifier (`classifyStub(signal, policy) -> {action, reason}`) as a pure
  function over a table of fixtures: alcohol-positive bar → keep; menu-platform → delete;
  no-alcohol no-site → delete; no-alcohol dead-site → delete; zero-HH cuisine → hide;
  good-site restaurant → keep under `alcohol-or-site`, hide under `alcohol-only`; blocked
  site → not delete; null site_health → alive.
- Dry-run against the live local DB and eyeball per-city counts before any `--apply`.

## Rollout

1. Build + unit tests green.
2. `pnpm cleanup:stubs` (all cities, dry-run, default policy) — review counts.
3. Compare the `alcohol-only` delta in the same report; decide policy.
4. `--apply` per the chosen policy.
5. Hand off to operator for prod publish.
