# Extraction-miss diagnosis — 2026-06-13

Diagnosis of the **38 venues** carrying a hand-written operator note (`data_audit.operator_note`)
across 8 cities — the ground-truth corpus from flag review. Method + taxonomy:
`docs/superpowers/specs/2026-06-12-extraction-miss-diagnosis-design.md`. Packets:
`docs/diagnosis-packets-2026-06-13.json` (regenerate: `pnpm tsx scripts/diagnose-misses.ts`).

**No venue data was changed.** This is diagnosis only; fixes are prioritized below for separate,
test-first work.

## Headline

The extractor is **not** failing at discovery or recall — it's failing at **precision**.

| Cat | Meaning | Count | Share |
|-----|---------|------:|------:|
| **D** | **Wrong capture** (wrong source/location, phantom windows, garbled offerings, day errors) | **19** | **50%** |
| F | Working as intended (operator confirmed correct, or a policy/validity call) | 13 | 34% |
| C | Recall miss (real HH, captured thin/incomplete) | 3 | 8% |
| B | Fetch/render miss (JS-wall, bot-wall) | 2 | 5% |
| A | Discovery miss (HH page never found) | 0 | 0% |
| E | Over-hide (correct window hidden by a gate) | 1* | — |

\* Charlie's is the one clear over-hide, but its primary defect is wrong-window *selection* (D), so it's counted in D.

**What this means for the four goals:**
- *"Dropping valid venues" / "missing valid venues":* largely **not happening** — discovery (A=0) and
  recall (C=3, all minor) are healthy. We find the venues and the HH pages.
- *"Including invalid venues / bad data":* **this is the real problem** (D=19). We capture data that is
  wrong — sourced from the wrong site/location, invented from menu/operating-hours pages, or garbled.
- The flag queue surfaces all of it, but until now nothing fed back, so precision never improved.

## The D bucket, broken into fix targets (ranked by leverage)

### 1. Source / provenance integrity — **highest leverage, data-trust critical** (≈6 venues)
The stored `source_url` points somewhere it shouldn't. This silently poisons good venues.
- **Wooden City Tacoma** — sourced from `cheerhop.com/tacoma/wooden-city-tacoma`, a **third-party
  aggregator**. The first-party guard only denylists 4 domains; aggregators like cheerhop leak through.
- **The Depot Bar** (Tucson) — sourced from `thedepotbar.com`; the venue's own site is
  `thedepotbar.shop`. Different business (a Nashville bar). **Source domain ≠ venue domain.**
- **Blanco Tacos** (Central Phoenix) — sourced from the **Paradise Valley** location's
  `?menu=happy-hour-menu`. Chain venue, wrong location's hours.
- **Ezbachi / Sushiholic / The Pemberton** — operator "looked everywhere, can't find this HH on the
  site." Windows with no locatable on-site source (carrd.co / banner-image-only / unknown origin).

**Fix surface:** (a) extend the first-party guard from a 4-domain allow-bypass to a real
aggregator denylist (`lib/ai/extractHappyHours.ts` source guard) — add cheerhop.com and siblings;
(b) a **source-domain-matches-venue-domain** check at persist (`persistExtractedWindows`) — flag/hide
when `source_url` host ≠ venue `website_url` host and isn't a known menu host; (c) for chains, require
the source location to match the venue (place_id / address), not just the brand.

### 2. Phantom windows from menu / operating-hours pages (≈4 venues)
Bare windows (no offerings) invented from a lunch or menu page that has no happy hour.
- **The Quarterdeck** — M–F 15:00–17:00, no offerings; operator "no hint of happy hour."
- **Sliver Pizzeria** — M–F 14:00–16:30 from a `/lunch-deals` page; no alcohol, not even a HH venue.
- (Also several bare no-offering windows below.)

**Fix surface:** the reconcile/realness gate should not let a window go live (or exist) when it has
**zero offerings AND no explicit happy-hour text** on its source — that's operating hours or a lunch
menu, not a deal. Ties into the existing `realnessGate` / `windowReconcile` work.

### 3. Offering quality — garbled, implausible, mis-kinded (≈4 venues)
- **Quesadilla Gorilla** — captured full-price cocktails ($15–16) and "$15 Happy Hour Monday" as the
  deal. Operator: "you captured the data wrong."
- **Wooden Nickel** — "$2 draft / $2 well / $2 domestic" — implausibly low (the gate correctly hid these).
- **The Backyard Public House** — food labeled as `drink`, per-day Tuesday specials merged onto every
  day, and a broken **23:00–14:00** window (crosses-midnight mis-parse).

**Fix surface:** extend `offeringSanity` (implausible-price floor; the $2 / $15-cocktail cases),
re-confirm the food/drink re-kind lexicon, and fix the crosses-midnight time parse that produced 23:00–14:00.

### 4. Day handling — collapse, no split, per-day over-apply (≈4 venues)
- **Finney's** — site says "Mon–Fri 3–5pm," we stored **Monday only**. Day-set collapsed.
- **Charlie's** — truth is "Mon–Fri 4–9, Sat–Sun 6–9"; we made a single wrong **Daily 6–9** live and
  hid the better window, plus captured junk weekend **breakfast** windows (8–2, 9–1).
- **PV Pie** — a window accurate for one day applied to all days.
- **Petra** — missing the "all day Sunday" window.

**Fix surface:** extractor day-set extraction (don't collapse a stated range), weekday/weekend
**splitting** when two schedules are stated, and per-day-special handling (don't broadcast one day to all).

### 5. Duplicate venues (1 case, but a class bug)
- **Petra Mediterranean** exists as **two venue rows**, identical. This is venue-level dedup, not just
  window dedup — worth confirming the `google_place_id` dedup didn't run or both rows lack the id.

## Fetch/render (B) — known, deferred
- **Eddie V's** — Darden bot-wall; no fetch tier reads it (empty 200). Needs a stealth/render tier or
  hand-supplied evidence. (Already your documented conclusion.)
- **The Mick** — happy-hour content behind 100% JS (the HH button doesn't change the URL). SPA render gap.

## Working-as-intended / policy (F) — 13 venues, NOT bugs
Confirmations and policy calls the flag queue surfaced correctly: **Linger Longer, PYRO, Beaver Bar,
Todos, HULA'S, Farrelli's, ZOLA** (operator verified the capture was right); **Ciao Grazie, Shio Ramen**
(ordering-platform sites → not real venues, see `platform_website_url`); **Terraza** (a resort → the
never-include-resorts rule); **The Mission, Heritage** (operator chose to keep as a stub pending a
joint look). These are where the system worked — and where the AI adjudicator (the `agent_verdict`
column) already agreed. Useful as positives.

## Per-venue table

| City | Venue | Cat | Root cause | Proposed fix |
|---|---|:--:|---|---|
| Central Phoenix | Blanco Tacos | D | Sourced PV location's HH for a Phx venue (chain wrong-location) | chain source-location match |
| Central Phoenix | Ezbachi | D | HH not locatable on own site (unverifiable origin) | source-domain check |
| Central Phoenix | Linger Longer | F | Operator confirmed correct | — |
| Central Phoenix | PV Pie & Wine | D | One-day special applied to all days | per-day handling |
| Central Phoenix | PYRO | F | Correct ("social hour" = HH, captured) | — |
| Central Phoenix | Sushiholic | D | Window unverifiable; carrd.co site, no HH page | source-domain check |
| Central Phoenix | The Beaver Bar | F | Adjudicator confirmed Daily 2–7 | — |
| Central Phoenix | The Pemberton | D | Window unsupported; true HH is an image banner w/ no times | offering+text gate; image OCR |
| Central Phoenix | The Sicilian Butcher | F | Operator: stub, won't trust 3rd-party | — (3rd-party guard) |
| Five Cities | The Quarterdeck | D | Phantom M–F 3–5, no offerings, no HH on site | bare-window gate |
| Oakland | Sliver Pizzeria | D | Lunch-deals page → HH; no alcohol venue | bare-window gate; venue validity |
| Oakland | Cook and Her Farmer | C | Real "oyster hour," offerings not captured | offering recall |
| Oakland | Todos | F | Adjudicator found on-site text; correct | — |
| SLO | Ancient Owl | C | "$1 off drafts" discount not captured | offering recall |
| SLO | Charlie's Place | D | Wrong window live + no weekday/weekend split + junk breakfast | day split; window selection |
| SLO | Finney's | C→D | "Mon–Fri" collapsed to Monday | day-set extraction |
| SLO | Petra (×2) | D | **Duplicate venue rows** + missing Sun all-day + no offerings | venue dedup; day; offerings |
| SLO | Quesadilla Gorilla | D | Full-price cocktails captured as the deal | offering sanity |
| Scottsdale | Cala Scottsdale | D | Wrong source/window ("till close" wrong; better HH page exists) | source selection |
| Scottsdale | Ciao Grazie | F | Operator: ordering-only site | platform_website_url |
| Scottsdale | Eddie V's | B | Darden bot-wall, unreadable | stealth/render tier |
| Scottsdale | Heritage Kitchen | F? | Likely correct (HH-menu page found); operator wants joint look | confirm |
| Scottsdale | HULA'S Modern Tiki | F | Operator verified Wed-only till-close | — |
| Scottsdale | Shio Ramen | F | Ordering platform (menu11) | platform_website_url |
| Scottsdale | The Mick | B | HH behind 100% JS (URL never changes) | SPA render |
| Scottsdale | The Mission | F | Operator chose stub (can't verify) | — |
| Spokane | The Backyard | D | Food-as-drink, per-day merge, 23:00–14:00 parse bug | offeringSanity; midnight parse |
| Spokane | ZOLA | F | Operator verified PDF; hours right (offerings thin) | offering recall (minor) |
| Tacoma | Farrelli's | F | Recovered from operator image; correct | — |
| Tacoma | Wooden City | D | **Source = cheerhop.com aggregator** (3rd-party leak) | aggregator denylist |
| Tacoma | Woven Seafood | D | Hours wrong (2–6 vs 2–5) | confirm; window |
| Tucson | Bistro 44 | D | Bar vs restaurant have diff hours; not split (location_within_venue) | location split; schema |
| Tucson | Fat Willy's | D | Seasonal/football event-specials captured as HH | seasonality/event filter |
| Tucson | Terraza Garden | F | Resort → exclude | never-include-resorts |
| Tucson | The Depot Bar | D | **Source thedepotbar.com ≠ venue .shop** (wrong/Nashville business) | source-domain check |
| Tucson | Vero Amore | F | Actually sourced /page/happy-hour correctly (note predates fix) | — |
| Tucson | Wooden Nickel | D | Implausible $2 offerings (gate correctly hid them) | implausible-price gate |

## Golden test candidates (lock the fixes)
- **Finney's:** source text "Happy Hour Mon–Fri 3–5pm" → days `{1,2,3,4,5}`, not `{1}`.
- **Charlie's:** "Mon–Fri 4–9, Sat–Sun 6–9" → two windows (weekday {1-5} 16–21, weekend {6,7} 18–21), no breakfast windows.
- **Wooden City:** `source_url` host = `cheerhop.com` → **rejected** by the first-party guard.
- **Depot Bar:** `source_url` host ≠ venue `website_url` host → flagged/hidden.
- **The Backyard:** time parse "11pm–2pm" never yields a 23:00–14:00 window.
- **Quesadilla / Wooden Nickel:** $15–16 cocktail / $2 well at "happy hour" → offering held for review (implausible).
- **Blanco:** chain venue; HH `source_url` from a different location's page → not applied.

## Recommended order of work
1. **Source/provenance integrity** (#1) — biggest data-trust win, ~6 venues + protects every future city.
2. **Bare-window gate** (#2) — removes phantom HH; cheap, deterministic.
3. **Offering sanity + midnight parse** (#3).
4. **Day handling** (#4).
5. Venue dedup (#5); render tier (B) stays deferred.

Each as its own branch + golden test, prioritized by this rollup — not one venue at a time.
