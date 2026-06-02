# Next steps — 2026-06-02

Single source of truth is **`main`** (`146590c`). Everything from today (PRs #1–#6) is
merged. 0 open PRs, 1 branch, 1 worktree. Start every task from here.

## ⚠️ Read first — the rule that stops the "double-branch disaster"

The chaos today came from **two agents typing in the same folder**, switching the
checkout under each other. Two non-negotiables:

1. **One worktree per agent.** Do NOT point two agents at this directory. Give each its
   own worktree on its own branch:
   ```bash
   git worktree add ../hhf-<task> -b <branch> origin/main
   ```
   Then they physically cannot disturb each other; `main` is the only meeting point.
2. **`main` is truth; integrate only via PRs.** One task → one branch off `origin/main`
   → PR → merge. No local "merge all branches." `git fetch && git merge --ff-only`
   before integrating. (Full rules: `CLAUDE.md` → "Branch & PR workflow".)

## ⚠️ Parallelize CODE, serialize DATA/DEPLOY

- **Code tasks** (below, group C) are independent — safe to fan out to separate agents
  in separate worktrees, each ending in a PR.
- **Data + deploy tasks** (groups D and G) all mutate the **same local DB** (then prod).
  **Do NOT run these in parallel across agents** — give them to ONE owner, in order.
  Concurrent DB writes are how you corrupt data and lose track of state.
- **Money:** `reextract:stubs` and `seed:enrich` make **paid** Anthropic calls. Set a
  spend cap in the Anthropic console first, and always run the `--dry-run` ($0) first.

---

## Group D — Data recovery & correctness (ONE owner, in order, local DB)

The extractor fix (PR #6) is now in `main` but **existing stubs were created before it**
and won't be re-checked by `seed:enrich`. Recover them, then clean correctness fields.

- [ ] **D1. Recover stub happy hours (highest value).** Per city:
  ```bash
  npm run reextract:stubs -- --city tucson --limit 25 --dry-run   # $0 — who qualifies
  npm run reextract:stubs -- --city tucson --limit 25             # ~$0.03/venue
  ```
  Then widen (drop `--limit`) per city once the sample looks right. *Why:* converts the
  ~53% stub rate into real listings — the product's biggest gap.
- [ ] **D2. (Optional, free) Harvest complement.** For stubs the paid extractor still
  misses, the free reader finds on-site signal:
  ```bash
  npx tsx scripts/harvest-hh.ts --city tucson   # $0, writes docs/hh-harvest.jsonl (read-only)
  npx tsx scripts/apply-harvest.ts              # writes reviewed windows to the DB
  ```
  *Why:* free recall (now sitemap-aware) for sites the model didn't capture.
- [ ] **D3. Correctness backfills (before go-live).**
  ```bash
  npm run backfill:timezones   # 138 venues have none → "Happening now" is WRONG without it
  npm run backfill:hours
  npm run reverify:all-day      # report → review → audited apply (deletes opt-in)
  ```

## Group G — Go-live / deploy (ONE owner, after Group D, touches prod)

- [ ] **G1. Migrate prod DB** to current (local is at the latest; confirm prod matches):
  `db:migrate` on the droplet. *Why:* schema must match code or the app breaks.
- [ ] **G2. Deploy code** to the DO droplet (git pull + build) — see
  `docs/data-sync-runbook.md` / memory `project_production_deploy`.
- [ ] **G3. `npm run push:data`** once local data is recovered & clean (after Group D).
- [ ] **G4. Confirm prod env keys** present: `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`,
  hCaptcha, Firebase (admin login), `RESEND_API_KEY`. Then **live smoke test**: one real
  submission end-to-end (captcha → classify → verify), one admin sign-in, confirm the
  pg-boss worker boots.

## Group C — Code follow-ups (PARALLEL-safe — separate worktrees → PRs)

- [ ] **C1. Adopt the canonical HH matcher in the enrich pipeline.** Point
  `lib/places/siteTriage.ts` (and any other matcher) at `lib/places/hhText.ts` so the
  *paid* extractor gets the same hyphen/spacing recall fix the harvest got. Small, isolated.
- [ ] **C2. (Optional) Sitemap discovery in enrich.** Feed `lib/places/sitemap.ts`
  results into enrich's `priorityUrls` so the extractor reads declared HH URLs, not guesses.

---

## Recommended sequencing

1. **Now (one owner):** D1 on a small sample per city → review → widen. Then D3 backfills.
2. **Then (same owner):** G1–G4 deploy with cleaned data.
3. **In parallel anytime (other agents, own worktrees):** C1, then C2.

Each code task (C) ends in a PR; each data/deploy step (D/G) is checked off here by its
single owner. Keep `main` as the only trunk.
