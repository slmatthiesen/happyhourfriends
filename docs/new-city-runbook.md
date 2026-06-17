# New-city onboarding runbook

The end-to-end path for taking a city from nothing to live on production. Each phase has
the exact commands, what "done" looks like, and what it costs. Run phases in order — the
city stays invisible (`status='discovery'`) until the final flip, so there's no rush and
nothing is public until you say so.

Recent real run for calibration: **Spokane** (~230k pop) cost **~$5 total**
(~$4 discovery + ~$1 enrich) and landed 205 venues, 34 confirmed-HH after the
reconcile gate, 99.5% neighborhood coverage.

**Prereqs:** local docker DB up (`docker compose up -d`), `GOOGLE_PLACES_API_KEY` +
`ANTHROPIC_API_KEY` in `.env`. All city-targeting scripts require **both**
`--city <slug> --state <code>`.

## One-shot path (recommended)

After Phase 1 (the city row + boundary GeoJSON exist), `onboard:city` runs the whole paid
pipeline — discover (Nearby + HH recall) → enrich `--batch` → city-wide summary — behind a
SINGLE upfront cost confirm, then stops at the operator review/go-live gate:

```bash
pnpm tsx scripts/onboard-city.ts --city <slug> --state <code> --estimate   # $0 preview
pnpm tsx scripts/onboard-city.ts --city <slug> --state <code>              # runs it (asks once)
```

`--yes` skips the confirm (needed for non-interactive/agent runs). It deliberately does NOT
flip the city live or touch prod — both operator-only. The phases below are the manual
equivalents (still valid for re-running a single step or for the neighborhood pipeline, which
`onboard:city` does not run — enrich assigns neighborhoods to existing polygons, but importing
OSM neighbourhoods for a brand-new city is still a separate Phase, see below).

---

## Phase 1 — Register the city (code, $0)

1. **Boundary file:** save the municipal boundary as `data/<slug>-boundary.geojson`
   (source it from the city's OSM boundary relation — e.g. Spokane is relation 237599).
   This one file drives discovery tiling, the insert gate, venue scoping, and cardinal
   districts. Prefer a **metro-scope** boundary over strict municipal limits
   (see memory `discovery-radius-undercovers-city`).
2. **City row:** add an entry to the `CITIES` array in `scripts/seed-cities.ts` — copy the
   Spokane block (slug, name, state, timezone, centerLat/Lng = boundary bbox center,
   `seedConfig` with `cellMeters: 3000` and `serviceLocalities` naming the city plus any
   enclave towns to keep).
3. Insert it (idempotent):

```bash
pnpm run seed:cities
```

**Done when:** the city row exists with `status='discovery'` — it renders nowhere
(no nav, sitemap, or llms.txt) until Phase 8.

---

## Phase 2 — Discover venues (PAID Google — run ONCE)

⚠️ Google Places `searchNearby` bills per tile call (~$0.03) with **no local ledger** — it
accrues invisibly. **Before running:** get the boundary-pruned tile count + dollar estimate
(an agent can replay the prune against local PostGIS for free — see memory
`feedback_report_tile_count_before_discovery`). Spokane: 48 tiles @ 3km ≈ $4 after adaptive
subdivision. Never re-run with `--fresh`; discover each city once.

```bash
pnpm run seed:discover -- --city <slug> --state <code> --debug-drops
```

Discovery is idempotent (upserts on `google_place_id`) and captures **hours, phone,
serves-alcohol, and the Google neighborhood name** per candidate for free — no separate
backfills needed for new cities.

**HH-targeted recall runs by DEFAULT** (no flag needed). After the Nearby sweep, discovery
also runs a Google Text Search for `"happy hour"` over the city bbox — the Nearby sweep's
nearest-20/tile cap truncates real HH anchors server-side (e.g. Jack's San Mateo was never a
candidate until recall), and Google exposes no HH field, so this taps its search relevance
instead. Adds a flat **~$0.12** (3 calls, hard-capped at the 60-result limit — it does NOT
scale with city size). Recovered venues run through the same gates + boundary + upsert.
Opt out with `--no-hh-recall` (legacy Nearby-only); add `--sub-tile` to pull >60 results in
dense cities. To backfill an already-discovered city cheaply, `--hh-recall-only` skips the
Nearby sweep. Always preview spend with `--estimate` ($0, prints the worst-case call count).

**Done when:** candidate count looks sane for the city's size (Spokane: ~200–300) and the
out-of-boundary localities you expected to drop (suburbs, neighbor cities) were dropped.

`--debug-drops` is free and non-optional: it writes every dropped candidate + reason to
`docs/<slug>-discovery-drops.json` so the operator can review the drop list per venue
(without it you only get aggregate counts — SLO 2026-06-12 lesson). Build the operator
review doc (live/hidden/stubs/drops, see `docs/san-luis-obispo-onboarding-review.md`)
at the end of the run.

---

## Phase 3 — Enrich (free-first, then paid)

Enrich runs the **$0 deterministic HTML parse first** and only pays the AI extractor for
candidates with real HH signal it can't parse cleanly. `--batch` is ~50% cheaper.

```bash
pnpm run seed:enrich -- --city <slug> --state <code> --batch
```

Every candidate becomes a venue — confirmed-HH or a help-wanted **stub** (a high stub rate
is inherent, not a bug; crowdsourcing fills it post-launch). Optional stub recovery passes
afterward, cheapest first — see `docs/OPERATOR-CHEATSHEET.md` §1–2:

```bash
pnpm run reextract:stubs:free -- --city <slug> --state <code>           # dry-run, $0
pnpm run reextract:stubs:free -- --city <slug> --state <code> --apply
pnpm run reextract:stubs -- --city <slug> --state <code> --dry-run      # paid escalation triage
```

**Done when:** enrich reports 0 unprocessed candidates. Cost: Spokane ~$1 (free-first);
budget up to ~$35 for a large city if web_search does heavy lifting.

---

## Phase 4 — Window-reconcile gate + spot-check

The gate merges duplicate windows, hides operating-hours-masquerading-as-HH, and resolves
overlaps. All changes are reversible (soft-delete / `active` flips, idempotent).

```bash
pnpm tsx scripts/regate-hidden.ts --city <slug> --state <code>             # dry-run ($0): preview promotes
pnpm tsx scripts/regate-hidden.ts --city <slug> --state <code> --apply     # flip stale-hidden→live
pnpm run reconcile:windows -- --city <slug> --state <code>          # dry-run first
pnpm run reconcile:windows -- --city <slug> --state <code> --apply
pnpm tsx scripts/spotcheck-free.ts --city <slug> --state <code>     # eyeball every LIVE window + evidence
```

⚠️ **`regate-hidden` is NON-OPTIONAL and easy to forget** (it is not a `seed:*`/`reconcile:*`
script). `active` is a STORED column set once at persist time, so any window persisted before a
gate improvement stays hidden until regate re-evaluates it. Skipping it benched **5 real HH on
San Mateo** (Lazy Dog, Hotaru w/ 8 offerings, Dog Haus, YAYOI) that the current gate already
passes — discovered 2026-06-16 only because the live count looked too low. Run it every city.

**Targeted re-extract for bare HH-URL windows (paid, ~$0.01–0.03/venue):** after regate, windows
that are still hidden as "bare" (time captured, 0 offerings) but whose source URL is a real HH page
(`/happy-hour`, `/specials`) are usually real — the extractor got the time but missed the deals.
Re-extract the page to recover offerings → they go live:
`pnpm tsx scripts/reextract-stubs.ts --city <slug> --state <code> --venue "<name>" --url "<hh-url>" --quick`.
San Mateo: 5/8 recovered for ~$0.15 (NEL, Lazy Dog, American Bull, Amici's, Johnston's). The rest
(JS-walled / no clear HH on the page) stay hidden for crowdsource. Manual entry is gated to
`hh_probe_status='blocked'` venues only (readable sites must be fixed via the extractor, by design).

**Done when:** you've eyeballed the live windows and each one is a real happy hour with a
plausible source. A misextracted venue means **fix the extractor/gate, never hand-patch
the venue** (memory `feedback_no_manual_venue_patching`).

---

## Phase 5 — Neighborhoods ($0)

Google's per-venue neighborhood name (captured at discovery) is the PRIMARY source;
polygons are the fallback for venues without one. Build the fallback layers, then assign:

```bash
pnpm run import:osm-neighborhoods -- --city <slug> --state <code>   # vernacular polygons (may be 0 — fine)
# METRO SLUGS ONLY (boundary = union of >1 town, e.g. san-mateo, five-cities): add each constituent
# town as a COARSE neighborhood so venues Google didn't sub-label still get a town + the dropdown
# offers each town by name. No-op for single-town cities. Run BEFORE backfill.
pnpm run import:locality-neighborhoods -- --city <slug> --state <code>
pnpm run generate:cardinal-districts -- --city <slug> --state <code> --downtown <lat,lng> # gap-free floor from the boundary file; ALWAYS pass the real CBD as --downtown (the centroid default lands far from downtown in elongated cities — Oakland was 5.5km off; --redo-downtown re-cuts it)
pnpm run backfill:neighborhoods -- --city <slug> --state <code>     # assign venues
pnpm run analyze:neighborhood-coverage -- --city <slug> --state <code>
```

**Done when:** coverage ≥95% (the gate) and the filter dropdown reads like names a local
would say. Spokane hit 99.5% on cardinal districts alone (0 OSM polygons — a data gap,
not a failure).

---

## Phase 6 — Data audit

Catches cross-venue contamination, wrong-city sources, implausible windows, third-party
source URLs. Full procedure: `docs/all-cities-audit-runbook.md`.

```bash
pnpm run audit:data -- --city <slug> --state <code>
# review flags in /admin/flags (or the emitted report), then:
pnpm run audit:fix -- --city <slug> --state <code>    # check its flags before applying
```

**Done when:** flags are adjudicated (keep/hide) and high-confidence fixes applied.

---

## Phase 7 — Local QA ($0)

```bash
pnpm run typecheck && pnpm run test:ci
rm -rf .next && pnpm run dev
```

Open `http://localhost:3000/<state>/<slug>` — check the table renders, neighborhood
filter looks sane, a few venue pages have correct times, "Now" badges behave. Run the
Phase 5 DB spot-check from the cheat sheet (`with_hours` vs `stubs` per city).

---

## Phase 8 — Flip live

```bash
PGPASSWORD=hhf docker compose exec -T db psql -U hhf -d happyhourfriends -c \
  "UPDATE cities SET status='live' WHERE slug='<slug>' AND state='<CODE>';"
```

Only `live` cities render in the UI, sitemap, and `/llms.txt`.

**Also commit the code side now** (one PR): the `seed-cities.ts` entry +
`data/<slug>-boundary.geojson`, via the normal branch → PR → merge flow.

---

## Phase 9 — Push to prod (additive — post-launch safe)

```bash
pnpm run push:data:additive              # DRY RUN — preview insert counts
pnpm run push:data:additive -- --apply   # commit
```

(`PROD_IP` comes from `.env`.) Additive push INSERTs only what prod doesn't have —
the new city + its venues/HH subtree, deduped on `google_place_id` — and **never modifies
an existing prod venue**, so user edits are safe. Full detail:
`docs/data-sync-runbook.md` → "Additive push".

If the code PR included schema/app changes, deploy the CODE channel first
(droplet: `git pull` → `npm ci` → `npm run db:migrate` → build → restart).

---

## Phase 10 — Verify on prod ($0)

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://happyhourfriends.com/<state>/<slug>   # 200
curl -s https://happyhourfriends.com/llms.txt | grep -i '<city name>'
curl -s https://happyhourfriends.com/sitemap.xml | grep '<slug>' | head -3
```

No search-console action needed — Google/Bing already have the sitemap and recrawl it;
the new city's `<lastmod>` entries are the freshness signal.

---

## Cost summary

| Phase | Cost | Notes |
|---|---|---|
| Register, neighborhoods, gate, QA | $0 | deterministic / local |
| Discover | ~$1.50–5 | per-tile Google billing; estimate first, run once |
| Enrich | ~$1–35 | free-first keeps it low; web_search is the variable |
| Audit | ~$0.30–1 | per-city share of the all-cities audit |
