# Trustworthy contribution pipeline — design

Date: 2026-06-01
Branch: `cluster-schema-seed-pipeline`
Status: Approved design, pre-implementation

## Problem

A customer wanted to add Doughbird's (a Phoenix stub) first happy hour. They pasted a
link to the venue's own happy-hour menu page into "Add a happy hour" — and nothing
useful happened:

- `new_happy_hour` submissions **skip the entire AI pipeline** (`app/api/submissions/route.ts:179-182`)
  — no interpret, no classify, no verify, no email. They land in `queued_admin` with a
  near-empty diff (only `{venueId}` + the URL) that `applySubmission` would actually
  **reject**, because the engine requires `venueId + daysOfWeek + startTime + source`
  (`lib/apply/engine.ts:311`).
- The AI flow that *could* read that link — the `intent` / "Suggest a change" flow — is
  **forbidden from creating new happy-hour windows** (operator decision; enforced in
  `lib/ai/interpreter.ts` + `prompts/interpret-submission.md`).

Net: a stub can never get AI-assisted first-HH data from a user, and the two entry points
("Add a happy hour", no AI; "Suggest a change", AI but can't create windows) are
redundant and confusing when stacked on a stub page.

The broader goal the operator articulated: **users need to submit up-to-date data when
they notice something is wrong or missing, and that data must be accurate and unable to
sabotage the site.** New windows, first-HH, price corrections, "they're closed now" — all
the same underlying problem: take a user contribution, prove it, and either auto-apply it
(only when self-authenticating) or queue it for the operator.

## Goals

- One contribution surface per venue that handles add-missing and fix-wrong uniformly.
- *Source* determines trust. A link to the venue's own site is self-authenticating; a
  photo or free text is not.
- Nothing inaccurate reaches the live site. Auto-apply only for self-authenticating,
  high-confidence, good-standing submissions — and even that is **off at launch**.
- The AI can propose **new** happy-hour windows (including a stub's first), not only edit
  existing data.
- A usable operator approval surface ("ok, make this change").
- Inappropriate uploaded photos are caught and rejected immediately, and evidence is never
  publicly exposed before it passes moderation.

## Non-goals

- Auto-applying anything from a photo or free text (always operator-gated).
- Rebuilding extraction/interpretation from scratch — we reuse the proven tools.
- New-venue submissions (the separate `/submit/new-venue` flow is unchanged).
- Production Firebase auth in phase 1 (dev-only local login now; Firebase before public).

## Trust matrix (the heart of the design)

| Source the user gives | What AI does | Where it goes |
|---|---|---|
| **Link on the venue's own domain** (host matches `venues.website`) + high-confidence extract | Extract structured windows/offerings (skip verify — source is authoritative) | **Auto-apply** when flag ON; else queue |
| **Photo** of a menu | Interpret → propose changes (incl. new windows) → verify (vision/web) | **Admin queue, pre-filled** + email |
| **Other-domain link** / low-confidence extract / **free text only** | Interpret → propose changes → verify (web) | **Admin queue, pre-filled** + email |
| Banned / rate-limited / low-trust submitter, or **critical** change (closed / no-HH) | — | Blocked or forced to admin queue (existing gates) |

**Auto-apply fires only when ALL hold:** first-party domain match **and** extractor
high-confidence **and** submitter in good standing **and** `CONTRIBUTION_AUTOAPPLY` flag
ON. Default flag **OFF** → during dogfooding nothing reaches the site unattended.

## Architecture & data flow

One submission type (`intent`, extended), one router, two existing AI tools.

```
Contribution (note? + url? + photo?)  ── POST /api/submissions ──► edit_submissions (pending)
        │                                   (after image-moderation gate, see below)
        ▼
  interpret/router (lib/jobs/handlers/interpret.ts)
        │
        ├─ URL host == venues.website host?  ── yes (first-party) ──► EXTRACTOR
        │                                                              (lib/ai/extractHappyHours.ts)
        │                                                              reads authoritative page →
        │                                                              structured windows/offerings
        │                                                              → SKIP verify
        │
        └─ no / no URL / photo / free text  ──► INTERPRETER (lib/ai/interpreter.ts, scope-extended)
                                                 reads note + photo + venue's current data →
                                                 proposes changes incl. NEW windows
                                                 → classify → verify (web/vision check)
        │
        ▼
  routeContribution({ firstParty, confidence, submitterTrust, flagOn }) → 'auto_apply' | 'queue'
        │                                        │
        ▼                                        ▼
  applySubmission(actor "ai")            queued_admin (pre-filled suggestion) + email
  audited + revertable + cache bust       operator: Apply / Edit-then-apply / Reject
```

The `intent` submission already carries a note + `sourceUrl` + evidence photo, so this is
an extension, not a new submission type. The `add-happy-hour` (`new_happy_hour`) public
entry point is retired; the interpreter now emits `new_happy_hour` *child ops* instead,
which the engine already knows how to apply (`lib/apply/engine.ts:297`).

## Components & responsibilities

### UI
- **`components/submit/contribute.tsx`** *(new — replaces `add-happy-hour.tsx` and
  `report-change.tsx`)*. Props: `venueId`, `venueName`, `hasHappyHour`. Fields: note,
  optional URL, optional photo/PDF, optional email, honeypot, captcha. Adaptive copy via
  `hasHappyHour` ("Know their happy hour? Add it" vs "Something off? Tell us").
  Validation: require **at least one** of {note ≥10 chars, URL, photo}. Posts the existing
  `intent` shape (`diff.after.note`, `diff.sourceUrl`, `evidenceImage`).
- **Venue page** (`app/[city]/venue/[slug]/page.tsx`): the stub empty-state block and the
  bottom "Keep this listing accurate" section collapse into a single `Contribute` block.
  Removes the redundancy.

### API
- **`app/api/submissions/route.ts`**: keep honeypot / captcha / rate-limit / body cap.
  Add the **image-moderation gate** (below) before storing evidence. Enforce the
  "at least one of note/URL/photo" rule. `intent` → status `pending` → `enqueueInterpret`.

### Jobs / AI
- **`lib/jobs/handlers/interpret.ts`** → becomes the router: first-party detection
  (compare submitted URL host to `venues.website` host), branch to extractor vs
  interpreter, then call `routeContribution`.
- **`lib/ai/extractHappyHours.ts`** → reused unchanged for first-party URLs; output mapped
  to child submissions (`new_happy_hour` + `new_offering`, or updates).
- **`lib/ai/interpreter.ts` + `prompts/interpret-submission.md`** → the **one scope
  change**: lift "never propose new windows" and add a `new_happy_hour` op to the tool
  schema. Op cap (`MAX_OPS`) stays. `normaliseOp` updated to accept it.
- **`routeContribution(...)`** *(new, small pure function)* → `'auto_apply' | 'queue'`
  from `{ firstParty, confidence, submitterTrust, flagOn }`. This is the load-bearing
  safety decision; it gets its own exhaustive unit tests.
- **`lib/jobs/handlers/classify.ts` / `verify.ts`** → today children are hard-gated to
  *never* auto-apply; replace that gate with a call to `routeContribution`. With the flag
  OFF (phase 1), behavior is identical to today (everything queues). First-party-URL path
  skips classify+verify (source is authoritative); photo/text path keeps both.

### Engine
- **No new write path.** `new_happy_hour`, `new_offering`, and HH/offering updates already
  apply + audit + revert. We only ensure the correct `source_url` rides along (the URL, or
  the stored photo URL). `source_url` enforcement on HH/offering writes is unchanged.

## Image moderation gate

Uploaded photos are currently re-encoded for safety (`lib/submit/evidenceStore.ts` — sharp
re-encode, EXIF strip, magic-byte PDF check) but **not content-checked**, and evidence
files go **public at upload time**. Two changes:

1. **Quarantine-until-pass storage.** Evidence is written to a **private** location at
   upload, not the public path. It becomes visible only after it passes moderation (and,
   ideally, only once the submission is approved). This also closes the existing
   "rejected-submission evidence goes public" gap.
2. **Synchronous moderation check** in `/api/submissions` (already `runtime: nodejs`),
   before the evidence is stored and the submission queued. Backend: **Google Cloud Vision
   SafeSearch** (same GCP account as `GOOGLE_PLACES_API_KEY`; enable the Vision API).
   Reject immediately — user-facing error, nothing stored, nothing queued — when `adult`,
   `violence`, or `racy` likelihood is at/above a configured threshold (e.g. `LIKELY`).
   - **PDF evidence** can't be SafeSearched directly: render the first page to an image
     first, or fall back to a Claude Haiku vision safety check. (Rare — most submissions
     are bartop menu photos.)
   - The downstream verifier already sees the photo; it can additionally note "this doesn't
     look like a menu" as a *soft* signal for the queue, but the **hard reject is
     SafeSearch** at upload.

New env: `GOOGLE_VISION_*` (or reuse the GCP key if scope allows) + a threshold constant.
Fail-open vs fail-closed: in production, **fail closed** if the moderation call errors
(reject the upload) to avoid leaking unmoderated content; in dev, allow.

## Operator approval surface ("ok, make this change")

- **`/admin` queue** already has the diff view + **Apply / Edit-then-apply / Reject**
  (`app/admin/page.tsx`, `app/admin/actions.ts`). Extend `SubmissionCard` to render the
  AI's **suggested structured happy hour** (days / times / offerings), the **source**
  (clickable link or photo thumbnail), and the AI's **confidence / verdict** — so each
  card is a self-contained "here's what they said, here's what the AI proposes, here's the
  proof → approve?" decision.
- **Auth:** dev-only **local admin login** (env-gated, localhost only) so the operator can
  review *today*; production **Firebase Google sign-in** (`requireAdmin` + `ADMIN_EMAIL`,
  already added) wired before any public exposure.

## Error handling & fail-safe (reuse existing patterns)

- No `ANTHROPIC_API_KEY` / model error → submission routes to `queued_admin`, never lost.
- First-party URL but extractor finds **no happy hour** → queue with a "no HH found at
  source" note; never fabricate.
- Interpreter returns no ops → parent → `queued_admin` with the raw note + photo.
- Bad/oversized photo → existing evidence-store hardening, plus the moderation gate.
- URL host unparseable or no `venues.website` on file → treated as **non-first-party**
  (safe default → queue).
- Moderation backend error in prod → fail closed (reject upload).

## Anti-sabotage (accuracy guarantees)

- **Auto-apply only when ALL hold:** first-party domain match, extractor high-confidence,
  submitter in good standing (not banned / low-trust / rate-limited), flag ON. Default OFF.
- Existing guards stay: captcha, honeypot, rate limits, banned fingerprints, classify
  risk-scoring.
- **Critical changes never auto-apply** (venue closed / "no happy hour") — always queue.
- Every write goes through the engine: `source_url` enforced on HH/offerings, `audit_log`
  before/after, **revertable**.
- Image moderation + quarantine-until-pass prevents inappropriate uploads from being
  stored publicly or reaching the operator's eyes.

## Testing

- **Unit (safety core):** `routeContribution` truth table — every
  `{firstParty × confidence × trust × flag}` combination, proving auto-apply only on the
  one safe row.
- **Unit:** first-party domain matching (www / subdomain / case / http-vs-https /
  no-website-on-file → not first-party).
- **Unit:** interpreter emits `new_happy_hour`; `normaliseOp` accepts it.
- **Unit:** image-moderation gate — a known-unsafe fixture rejects, a known-safe menu
  fixture passes (mock the SafeSearch client).
- **Script driver** (local handler invocation against the dev DB) exercising three real
  cases: first-party URL on a stub, photo on a stub, free-text correction on a populated
  venue — asserting each lands in the queue with a correct structured suggestion.
- **Manual dogfood** — the actual goal: operator + friends submit, operator watches
  `/admin`.

## Rollout (phased)

- **Phase 1 (this spec):** unified contribution box + router + scope-extended interpreter
  + image-moderation gate + admin card + dev-only login. Auto-apply flag **OFF** —
  everything queues. Dogfood with friends; observe what people submit and what the AI
  proposes.
- **Phase 2 (small follow-up):** flip `CONTRIBUTION_AUTOAPPLY` on for first-party
  high-confidence once the output is trusted; wire Firebase auth before any public
  exposure.

## Decision log

- Auto-apply trust hinges on **strict domain match** to `venues.website`; no stored
  website → not first-party → queue. (Chosen over AI-judges-authenticity.)
- Scope covers **both** stub first-HH and corrections to existing venues — unified, not
  just "additional windows."
- **One** contribution surface (Option A), not two upgraded entry points.
- Architecture: **source-routed reuse** of extractor + interpreter (Option 1), rolled out
  **phased** (Option 3) — auto-apply designed now, enabled later.
- First-party-URL path **skips verify** (authoritative source); photo/text keeps verify.
- Operator approval via the **real `/admin` web queue**; dev-only login now, Firebase
  before public.
- Image moderation hard gate: **Google Cloud Vision SafeSearch**, synchronous at upload,
  quarantine-until-pass storage.
