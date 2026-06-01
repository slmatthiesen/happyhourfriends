# Happy-hour data recovery — FREE pipeline (handoff plan)

## EXECUTED 2026-05-31 — round 1 results

Ran `harvest-hh.ts` over all 292 stub-with-website venues ($0, no API). Built
`scripts/apply-harvest.ts` (dry-run default, `--apply`, audited via `audit_log`
actor `harvest-recovery`, dedups on natural key, derives `start_time` from
`hours_json` for `"open"` windows). Curated `docs/hh-recovered.json` (clear wins
only) and applied.

**Recovered 14 venues / 15 windows / 23 offerings, all promoted stub→complete:**
phoenix-central 95→103, scottsdale 110→114, tucson 85→87 (tacoma unchanged —
no tacoma stub surfaced signal). Venues: Arizona Wilderness, Aunt Chilada's
(JSON-LD `open–6PM`, start derived 11:00), Bobby-Q (×2 rows), Dilla Libre
(daily + Thursday all-day), Lovecraft, Orchard Tavern, The Parlor, Mastro's
City Hall + Ocean Club, Rooster Tavern, Tommy Bahama, El Sur, Gentle Ben's.

**Key finding (tempers the "~50% stubs = tooling failure" premise):** only
**24 / 292 (8%)** stub sites surfaced ANY happy-hour signal to plain fetch.
The harvester DID prove the paid extractor's misses are real — Aunt Chilada's
(`/menus` JSON-LD) and Arizona Wilderness (inline-`<script>` "2-5PM Mon-Fri")
were recoverable for $0 — but the bulk of stubs are NOT plain-HTML tooling
losses. They are: (a) genuinely no published HH, (b) JS-rendered menus
(Pita Jungle store-locator JSON, Rooster's spotapps), or (c) third-party-only
mentions. So crawling-recall fixes a real-but-small slice; the long tail needs
crowdsource + targeted JS rendering, not more plain-fetch passes.

**Deliberately SKIPPED (not clear wins, documented not silently dropped):**
Blanco/Las 15 Salsas/Mariscos (time but NO days), Kobalt ("all day" ambiguous
days), The Porch / Ajo Al's / Dierks (no times), Chompie's ("Glendale location
ONLY" — not this venue), Pita Jungle (store-locator JSON mixes all locations'
hours — can't attribute to the Scottsdale row), Wild Garlic Grill (source was
tucsonfoodie.com — third-party aggregator, violates first-party rule).

**Follow-ups:** (1) headless render for Pita Jungle / spotapps / Toast widgets;
(2) the "no days" venues (Las 15 Salsas 12–6pm, Mariscos $5 3–7pm) could be
crowdsource targets — times known, days not; (3) re-run harvest after any new
city discovery. To revert this batch: `audit_log WHERE actor='harvest-recovery'`.

---

**Status: ROUND 1 DONE (above). Plan below is the original handoff.**
**Hard rule: NO Anthropic API / `web_fetch` / `ANTHROPIC_API_KEY`. Everything below is free
(`curl`-style Node fetch + deterministic parsing + the operator's Claude subscription for
reading). The metered pipeline already cost ~$30 and missed easy data — do not use it.**

## Why we're here (root cause of the ~50% stub rate)

Coverage today (`venues` with active `happy_hours` vs total):
- phoenix-central 95/223 · scottsdale 110/173 · tacoma 37/65 · tucson 85/188 (~50% are stubs).

The stubs are **mostly a tooling failure, not missing data.** Proven with Aunt Chilada's
(operator-confirmed easy find): its HH ("Mon–Fri, Open–6 PM, drink+appetizer specials") sits
in the page's JSON-LD at `/menus/`, yet it's a stub. Two independent defects:

1. **Schema drops valid windows.** `lib/ai/extractHappyHours.ts`
   - line ~323: `allDay && daysOfWeek.length >= 3` → entry dropped.
   - line ~340: `allDay=false` requires non-null `startTime` → "Open–6 PM" (null start) dropped.
   - DB CHECK `happy_hours_all_day_shape` enforces the same: `all_day=false` ⇒ `start_time NOT NULL`.
   - Net: "opens until X" and "Mon–Fri all-day" and weekday specials ("$2 burgers all Monday")
     have **no legal representation** → silently discarded even when read correctly. (Same family
     as the Red Hot all-day gap in memory `project_extractor_misses_all_day_specials`.)
2. **Recall.** Old May 27–31 runs predate the `priorityUrls` feature; they often read only the
   homepage and never landed on `/menus` / `/happy-hour` where the structured data lives.

So the paid pipeline fetched pages (spending money) and then cheap logic threw the result away.

## The free architecture (3 steps)

1. **Harvest (built — `scripts/harvest-hh.ts`).** Plain Node fetch over every stub-with-website.
   For each venue: fetch homepage, follow on-page happy/menu links (≤3), AND guess common paths
   (`/happy-hour`, `/happyhour`, `/happy-hour-menu`, `/specials`, `/menu/happy-hour`, `/menus`,
   `/menu`, `/drinks`, `/drink-menu`). From every fetched page it extracts (a) JSON-LD nodes
   mentioning "happy hour" and (b) raw-HTML + visible-text snippets around "happy hour" carrying a
   day/time (raw scan catches HH buried in inline `<script>` data, e.g. Arizona Wilderness).
   Writes `docs/hh-harvest.jsonl` (one digest per venue). **Cost: $0.**
   - Run: `npx tsx scripts/harvest-hh.ts` (all cities) or `--city <slug> [--limit N]`.
2. **Extract (operator's Claude subscription — me, in-thread).** Read the digests and turn each
   into structured HH (days_of_week[], start/end or all_day, ≤8 offerings, `source_url` = the page
   the data came from). NEVER fabricate — only what's literally on the page (PRD §13). For
   "opens–X" windows, derive `start_time` from the venue's `hours_json` open time for those days
   (already backfilled) so the DB CHECK is satisfied.
3. **Write (build — a small `scripts/apply-harvest.ts`).** Insert `happy_hours` + `offerings`
   from a reviewed JSON file, dedup on the natural key, set `data_completeness='complete'`,
   `last_verified_at=now()`, `source_url` required. Dry-run by default; `--apply` to write. Audited.

## Code fixes needed (free, no AI)

- **Represent "opens until X".** Either (a) writer derives `start_time` from `hours_json`, or
  (b) relax the model/schema to allow it. Minimum viable: writer-side derivation in step 3.
- **(Optional) loosen `extractHappyHours` drop rules** so the paid path, if ever used again,
  stops discarding open-until-X / weekday-all-day. Lower priority since we're going free.
- Add a `triage:stubs`-style per-item try/catch isolation if any AI is ever reintroduced (the
  current script aborts a whole city on one API error — that's how the credit-exhaustion crash
  silently produced no scottsdale report).

## Known limitations (document, don't silently skip)

- **JS-rendered menus** (e.g. 36 Below via spotapps, Toast/Square widgets) won't yield to plain
  fetch. Options: hit the widget's JSON API directly, or a headless render (Playwright) — both free.
  Flag these venues in the harvest as `signal:false, jsRendered:true` rather than calling them "no HH".
- **No-site stubs** (15 venues) and dead-site kills (6) — separate crowdsource/cleanup track; see
  `docs/<city>-killed-venues.md` (all dry-run, nothing deleted).

## Cost guardrails (set BEFORE any future run)

- **Anthropic Console: set a hard monthly spend cap + email alert.** Provider-side, agent-proof.
- Keep `ANTHROPIC_API_KEY` out of the shell env the agent inherits; pass it manually only when
  the operator chooses to run a paid step.
- Optional: a PreToolUse hook in `.claude/settings.json` that denies Bash commands containing
  `seed:enrich` / `triage:stubs` / `reverify` / `ANTHROPIC_API_KEY` (via the `update-config` skill).
- The harvester and writer above use ZERO API — they are the default path.

## First actions for the new thread

1. `npx tsx scripts/harvest-hh.ts` (all 292 stub-with-website venues) → measure true recovery rate.
2. Read `docs/hh-harvest.jsonl`; structure the clear wins (JSON-LD + explicit text) into a reviewed file.
3. Build `scripts/apply-harvest.ts`; dry-run; operator reviews; `--apply`.
4. Triage JS-rendered venues into a follow-up (headless render).
5. Re-measure coverage; repeat.

## Don't repeat these mistakes
- Don't call a run "free" without checking — `triage:stubs`/`seed:enrich` dry-runs make paid
  `web_fetch` calls. The harvester here genuinely makes none.
- Don't re-run a paid multi-city job to re-verify a fix; verify with unit tests + one free sample.
