# Stub curation + anti-bot fetch tier — design

**Date:** 2026-06-23 · **Branch:** `feat/stub-curation-and-anti-bot-fetch`
**Origin:** San Jose post-mortom (`docs/san-jose-extraction-postmortem-2026-06-22.md`) — 14% hit
rate driven by (1) HH-poor cuisine mix, (2) the alcohol gate, and (3) **15% of misses are
bot-walls** (Cloudflare) + SPA/social/Toast embeds we can't fetch.

Three coordinated pieces, built in order. A and B are independent; the deletion runs **after**
both so recovery happens before we delete anything.

---

## Build A — Dead-end stub suppression

**Problem:** the public list is padded with stubs that have no path to ever being a happy hour
(no alcohol, or a cuisine that ~never runs HH). 100+ dead-end stubs make the product read as
empty/broken.

**Predicate** — `lib/places/stubGate.ts` → `isDeadEndStub(v)`: true when a venue has **no active
HH** AND (`fails the alcohol gate` OR `primary_type ∈ ZERO_HH_TYPES`).
- Reuses existing `passesAlcoholGate` (serves_alcohol=false, no name/type override).
- `ZERO_HH_TYPES = {korean_restaurant, vietnamese_restaurant, chinese_restaurant}` — derived
  from cross-city confirmed-HH rate (korean 0%, vietnamese 4.2%, chinese 8.5%); thai/indian
  already excluded pre-discovery; hawaiian/taco deliberately EXCLUDED (operator: they do run
  HH). Documented in the file with the query + date; refreshable.
- Auto-protects what matters: bars/American/seafood/etc. pass the alcohol gate and aren't
  zero-HH types, so they're never suppressed. A bot-walled bar (Rise Woodfire = `restaurant`,
  alcohol=true) is NOT a dead-end and is never hidden.

**Mechanism — HIDE (reversible):** set `venues.status='no_happy_hour'` (existing unused enum
value). Exclude that status from the **public** query only (`lib/queries/venues.ts`:
`listVenues` + the landing `stubCount`/`withHours` split). Admin still sees them.

**Re-activation:** the persist path (`persistExtractedWindows` / apply engine) flips status back
to `'active'` whenever an active HH lands on a `no_happy_hour` venue (Build B recovery, regate,
crowdsource). Suppression never traps the data.

**Components:**
1. `lib/places/stubGate.ts` — `isDeadEndStub` + `ZERO_HH_TYPES` + unit tests.
2. `lib/queries/venues.ts` — exclude `status='no_happy_hour'` from public list + counts.
3. `scripts/suppress-dead-end-stubs.ts --city --state [--apply]` — $0 dry-run default,
   all-cities mode, by-type report. Retroactive across live cities.
4. `scripts/seed-enrich-candidates.ts` — at stub creation, if `isDeadEndStub` set
   status='no_happy_hour' so new cities never surface them.
5. Persist-path re-activation.
6. Tests: predicate units + public-query-excludes-no_happy_hour.

---

## Build B — Anti-bot fetch tier (Jina), as the LAST resort

**Problem:** ~15% of misses are Cloudflare-walled; more are JS/Toast/image-menu embeds. Our
static fetch + existing render can't pass managed challenges. Proven: Jina Reader bypasses
Cloudflare (Jack's SJ → "Happy Hour 3–6pm" recovered as text; Rise Woodfire → menu read via
screenshot→vision).

**Provider abstraction** — `lib/places/fetchProviders/` with an interface:
```
interface FetchProvider { fetchText(url): Promise<{html,status,blocked}>; 
                          fetchScreenshot?(url): Promise<{pngPath}>; }
```
- `JinaFetchProvider` (env `JINA_API_KEY`, already in `.env`): `fetchText` via `r.jina.ai`
  (markdown), `fetchScreenshot` via `X-Return-Format: screenshot` → download PNG.
- Selected via factory; off cleanly when no key (returns blocked=false/no-op).

**Free wall detection** — `lib/verification/fetchUrl.ts`: deterministic Cloudflare/anti-bot
fingerprint (`just a moment`, `cf_chl`, `challenge-platform`, `enable javascript and cookies`)
→ return `blocked: 'bot_wall'`. $0, no false-positive risk. Also flags empty SPA shells
(<~6KB, no HH signal, no links).

**Fetch ladder (the ordering is the whole point — Jina is LAST):**
1. Normal `fetchUrl` (free).
2. Existing headless render for plain SPA shells (free).
3. Free HH-signal gate / free HTML parse (existing).
4. **Jina text** — only if wall-detected OR render still empty AND venue is HH-likely.
5. **Jina screenshot → vision** — only if Jina text still yields no HH signal (Toast/image
   menus). Screenshot PNG fed to the existing native-image extractor path.

Tiers 4–5 are **paid + gated**: fire only on `blocked`/empty AND HH-likely (alcohol +
bar/American/gastropub-ish), so cost is bounded to the measured ~15% walled minority, not a
blanket re-fetch. Lives in the **shared** `extractHappyHours`/`siteContent` path so enrich,
reextract, AND admin "extract from URL" all benefit (per the shared-path escalation lesson).

**Components:**
1. `lib/places/fetchProviders/` interface + `JinaFetchProvider` + factory + unit tests
   (injectable HTTP, no network in tests).
2. `fetchUrl` wall/empty-shell detection returning a typed `blocked` reason.
3. `siteContent`/`extractHappyHours` ladder: escalate to Jina text → screenshot last.
4. Screenshot→vision: download PNG, hand to the existing image-reading extractor.
5. Budget/ledger: record Jina + vision spend in `ai_usage_ledger`; per-run cap.
6. Tests: detection fingerprint, provider parsing, ladder ordering (Jina not called when
   free tiers succeed), gating (skipped for non-HH-likely).

---

## Cleanup — delete the 3-type empty stubs (runs AFTER A + B)

After Build B recovery, korean/vietnamese/chinese venues that **still have no active HH** are
genuine dead weight. **Soft-delete** them (`deleted_at`, reversible, respected by
soft-delete-aware persist so they don't resurrect on re-discovery). A later verified HH
submission for one un-deletes it (apply engine).
- `scripts/delete-empty-cuisine-stubs.ts --city --state [--apply]` — $0 dry-run, all-cities,
  by-type report. Run order documented: regate → Build B recovery → this.
- Distinct from Build A's hide: these are deleted (gone everywhere), not just hidden from public.

---

## Sequencing & rollout

1. Build B first (recovers walled venues → fewer false dead-ends).
2. Build A (hide the no-alcohol/zero-HH-cuisine net).
3. Cleanup deletion (the 3-type still-empty stubs).
4. Re-run over San Jose as the proving ground; measure stub count before/after + HH recovered
   from the walled set. Then backfill other live cities.

## Risks
- Jina cost on dense walled cities — bounded by HH-likely gating + per-run cap; measure on SJ.
- Over-suppression — mitigated by: rule never touches HH-likely/alcohol venues; hide (not
  delete) for the broad net; deletion limited to the 3 lowest-converting cuisines.
- Jina key in chat log — rotate after wiring (operator).
- `no_happy_hour` status currently unread by any code — safe to start setting it.
