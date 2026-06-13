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

## Deep dive: Spencer's — the schema.org JSON-LD Menu gap (added 2026-06-13)

Spencer's for Steaks & Chops (Spokane) is in the meal-special review queue as a single
**"$42" daily 3–5pm** "offering" (`extract_confidence: 1.0`). It is a steakhouse with a real,
rich happy hour. Traced the miss layer by layer:

- **Discovery:** OK — we used `spencersspokane.com/menus/`, the right page.
- **Render:** OK — the HH content is in the **static HTML** (no iframe / JS widget).
- **Root cause:** the entire happy-hour menu is published as **schema.org JSON-LD**
  (`<script type="application/ld+json">`, `"@type":"Menu"` → `hasMenuItem` → `MenuItem`/`Offer`):
  Spinach & Artichoke Dip $12 (+crab $5), Roasted Nuts $5, Pork Belly Flatbread $12, Prime Bites
  $19, Hummus $13, Fries $7, Soup $6, Chips $3; Well Liquor $8, House Martinis $13, House Wine
  $6.50, beer $6–11 — **108 `MenuItem`s on the page.** Our pipeline does **not parse JSON-LD Menu
  schema at all** (the only `ld+json` code in `lib/` emits *our own* site's SEO data). The
  structured menu is dropped with the `<script>` tags; the model falls back to visible text,
  grabs a stray **"$42"** from the *Sunday Supper* section (~6 KB before the HH block — it's a
  prix-fixe price), and emits one offering literally named "$42" — at full confidence.

**Why it matters / leverage:** JSON-LD `Menu` schema is auto-emitted by common restaurant CMSs.
A 7-site sample of other flagged venues found **Wooden Nickel** also ships `Menu` schema (8 items)
we're ignoring; Finney's/Petra/ZOLA emit JSON-LD but not menu items; Cala/Quarterdeck have the HH
only in visible HTML. So parsing JSON-LD Menu is a **free, deterministic, highest-precision**
recovery for a real subset (~25–30% here, likely more across 1000 cities) — exact name/price/
description, no AI guessing. It is complementary to fixing visible-text extraction for the rest.

This also exposes a **confidence-calibration** problem: a garbage single-"$42" capture was stored
at `extract_confidence: 1.0`, so the realness gate had no low-confidence signal to catch it.

**New top fix bucket (0):** a deterministic JSON-LD harvester before the AI extractor — parse
`Menu`/`MenuItem`/`Offer`, pick the menu whose name (or nearest heading) matches `HH_RE`
("happy hour"/"social hour"), emit its items as structured offerings; feed the rest to the model.
Golden: Spencer's `/menus/` → the 12 HH items at their real prices, never a "$42".

## The D bucket, broken into fix targets (ranked by leverage)

### 1. Source / provenance integrity — **highest leverage, data-trust critical** (≈6 venues)
**STATUS: SHIPPED — PR #125** (`lib/recover/sourceProvenance.ts`, wired into the one persist
path; goldens in `scripts/test-source-provenance.ts`). To find ALREADY-stored bad-source windows
that predate the fix, run the $0 read-only audit: `pnpm audit:provenance [--city <slug> --state <code>]`
(report → edit actions → `--apply`). Sub-fix (c) "chain source-location match" was **deferred**: the
Blanco golden turned out to be a cross-domain mismatch caught by (b), and a same-domain
different-location heuristic has no corpus golden + real over-hide risk.

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
0. **JSON-LD Menu harvester** (Spencer's deep-dive) — free, deterministic, highest-precision
   recovery of full HH menus we currently drop; recovers recall AND precision; generalizes to any
   CMS that emits it.
1. **Source/provenance integrity** — biggest data-trust win, ~6 venues + protects every future city.
2. **Bare-window gate** — removes phantom HH; cheap, deterministic.
3. **Offering sanity + midnight parse + confidence calibration** (the $42@1.0 case).
4. **Day handling**.
5. Venue dedup; render tier (B) stays deferred.

Each as its own branch + golden test, prioritized by this rollup — not one venue at a time.
