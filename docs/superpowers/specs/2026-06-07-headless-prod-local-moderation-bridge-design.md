# Headless prod + local moderation bridge — design

**Date:** 2026-06-07
**Branch:** `feat/additive-data-sync` (extends the additive sync work in commit `1ca396a`)
**Status:** approved design, pre-plan

## Problem

Prod has no `/admin` endpoint, and the operator wants to keep it that way — both for
attack-surface reduction and because all curation already happens locally. But prod's AI
moderation pipeline parks every submission it *can't* confirm as `queued_admin`, and there
is no human surface on prod to action those. They pile up unhandled.

Goal: a bridge that brings the `queued_admin` leftovers to the operator's local `/admin`,
and — on approval — publishes the resulting change up to prod automatically. Prod stays
headless; the human-in-the-loop runs entirely on the desktop.

## Non-goals

- Changing prod's AI pipeline. Prod keeps auto-applying any change it can confirm from the
  submitter's link, directly to prod, with no human involvement. Only the leftovers bridge
  down.
- Building special two-master conflict resolution. A same-day collision (prod's AI and the
  operator both editing the same venue) is rare enough that we do not engineer for it beyond
  the free natural-key safety below.
- Flags / community-vote moderation. Scope is **new venues + edits to existing venues** only.

## Current behavior (baseline, do not change)

With `ANTHROPIC_API_KEY` set on prod (it is):

1. Submission arrives on prod → AI classify → AI verify against the submitter's source link.
2. AI confident → **auto-applies directly to prod** (actor `ai`), writing through the apply
   engine + `audit_log`. Most clean submissions resolve here, untouched by the operator.
3. AI not confident (ambiguous, contradicted-but-plausible, high-risk venue→closed, etc.)
   → submission parked as `queued_admin` on prod.

Step 3 is the only gap. Everything else already works end-to-end.

## Design

Three components. Most logic lands in the existing `lib/sync/dbSync.ts`.

### 1. Pull leftovers down (nightly cron, already running)

Add a step to the existing prod→local pull that copies prod `edit_submissions` rows where
`status = 'queued_admin'` into the local `edit_submissions` table.

- **Idempotent** — upsert by submission `id` (UUID). Re-running the nightly pull is safe.
- Once a submission is resolved (see §3, it flips to `applied` on prod), it no longer matches
  the `queued_admin` filter and stops coming down. No tombstones needed.
- The local `/admin` queue renders these with the existing UI, unchanged — the diff lives in
  the submission row, and the target venue is already mirrored locally by the existing
  `upsertPull`.
- The nightly pull must **not** clobber a local edit the operator has approved but not yet
  published. Practically: the pull only touches `edit_submissions` here, and venue/curation
  upsert is already PK-keyed and never deletes, so a pending local change survives.
- **On-demand pull (same logic, runnable anytime).** The leftover-pull is exposed as a manual
  command (e.g. `npm run pull:queue`) in addition to the nightly cron, so the operator can
  force the queue down immediately when something can't wait until overnight. Idempotent, so
  running it ad-hoc and then having the cron run later is harmless.

### 2. Local review (existing `/admin`, unchanged)

Operator opens local `/admin`, sees the leftover queue, and clicks Apply / Reject / edit-then-
apply exactly as today. No UI work expected beyond what already exists.

### 3. Approve → auto-publish to prod (the one real build)

The local `/admin` Apply action does two things:

1. **Apply locally** via the existing engine (`applySubmission`) — writes the local DB and
   `audit_log`. Works for new venues *and* edits to existing venues (the engine already
   supports both paths).
2. **Publish that one venue's subtree up to prod**, immediately, over an SSH tunnel:
   - Upsert venue + happy_hours + offerings + tags for that single venue.
   - **Match `happy_hours` / `offerings` by natural key, not by id.** `happy_hours` already
     has a natural-key unique index (venue + sorted `days_of_week[]` + start/end); matching by
     it means the worst case is a rejected duplicate insert, never two copies of one window.
     This is free insurance, not collision-handling.
   - Carry the submitter's evidence link as the change's `source_url` on prod, so prod stays
     self-consistent (prod is the only place that held the original submission).
   - Flip the prod `edit_submissions` row to `applied` so it leaves the operator's queue on the
     next pull.

New mechanism: a `publishVenueToProd(venueId)` function in `lib/sync/dbSync.ts` that performs
the scoped upsert + the prod submission status flip in one tunneled transaction. Called from
the admin Apply server action.

### Revert round-trips (first-class, not an afterthought)

Because auto-publish is instant with no confirm gate, a misclick goes live immediately. The
existing `revertAudit` path is local-only today. Extend it so reverting a change that was
published to prod **also publishes the revert upward** (re-runs `publishVenueToProd` for the
reverted venue state). A misclick must be recoverable end-to-end, not just locally.

## Data flow

```
user submits on prod
   └─ AI confirms?  ── yes ─→ auto-applied on prod        (done, never touches operator)
                     └─ no  ─→ queued_admin on prod
                                  └─ nightly pull → local /admin queue
                                        └─ operator clicks Apply
                                              ├─ applySubmission → local DB + audit
                                              └─ publishVenueToProd:
                                                    • upsert venue subtree (natural-key HH/offerings)
                                                    • source_url = submitter link
                                                    • prod submission → applied
   operator clicks Revert
        └─ revertAudit (local) → publishVenueToProd(reverted state)   (reaches prod too)
```

## Credentials & security

Auto-publish requires the operator's running local server to reach prod at runtime:
`PROD_IP` + an SSH key in local `.env`. The existing bash sync scripts already SSH into the
box; the Apply action reuses that path.

**Accepted tradeoff:** "fully automatic" moves some attack surface off prod and onto the
desktop — the running dev server can now write the live DB.

**Initial build:** reuse the existing SSH credentials path the bash sync scripts already use.
**Follow-up (tracked, not in initial scope):** swap in a **dedicated, narrowly-scoped SSH key**
for publish, never the operator's root key. Important for later; not blocking the first version.

## Risks (assessed, accepted)

| Risk | Disposition |
| --- | --- |
| Two-master same-venue collision (prod AI + local, same day) | Rare; not engineered for. Natural-key HH/offering match is the only (free) guard. |
| Standing prod write access from the desktop | Accepted for convenience; scoped SSH key limits blast radius. |
| Instant publish, no undo gate | Mitigated by making revert round-trip to prod (§ Revert). |
| Uploaded-photo evidence lives on prod's disk | Local queue links to the prod URL; reviewable, no copy needed. |

## Open questions

None blocking. Implementation plan next.
