# San Jose extraction post-mortem — why the hit rate looked low

**Date:** 2026-06-22 · **Candidates:** 638 · **Venues created:** 326 · **Live HH:** 47
**Headline rates:** 47 live / 326 venues = **14.4%** · 47 / 638 candidates = **7.4%**

## TL;DR

San Jose is **not** a fair comparison to SF, and the low number is mostly **the candidate
mix, not the pipeline** — but there *is* a real recall bug underneath, and bars are the proof.

Three compounding causes, in order of size:

1. **The candidate mix is structurally happy-hour-poor.** San Jose dining is dominated by
   Asian cuisines that don't run American-style happy hours. ~176 of 638 candidates (28%)
   are Vietnamese/Chinese/Japanese/Sushi/Korean/hot-pot/noodle/tea — and they produced **3
   HH total (1.7%)**. This is the food scene, not an extraction failure.
2. **The alcohol gate removes ~45%.** 287/638 candidates had `serves_alcohol=false`; ~270
   were filtered before extraction. No alcohol → no HH possible.
3. **Real recall failures on the HH-likely subset.** The venues that *should* convert —
   bars — largely didn't, and the cause is **bot walls, Facebook-only pages, and JS SPAs**,
   not absent happy hours.

## The funnel

| stage | count | note |
|---|---|---|
| candidates | 638 | discovery (incl. sub-tile HH recall) |
| killed (dead/no site) | 41 | `killed_no_site` |
| filtered pre-extract | 270 | alcohol gate + no-site stubs |
| extracted, no HH found | 268 | **the bucket that hides the bug** |
| confirmed HH | 58 | → 47 live after the realness gate |

## Hit rate by venue type

**HH-rich (worked):**

| type | HH / candidates | rate |
|---|---|---|
| sports_bar | 2 / 5 | 40% |
| seafood_restaurant | 5 / 13 | 38% |
| american_restaurant | 5 / 23 | 22% |
| barbecue / bar_and_grill / cocktail_bar | 2/10 · 1/5 · 1/5 | ~20% |
| restaurant (generic) | 12 / 95 | 13% |
| mexican_restaurant | 6 / 71 | 8% |
| pizza_restaurant | 3 / 43 | 7% |

**HH-absent by cuisine (structural — these almost never run HH):**

| type | HH / candidates | rate |
|---|---|---|
| vietnamese_restaurant | 0 / 58 | 0% |
| chinese_restaurant | 1 / 53 | 2% |
| japanese_restaurant | 1 / 20 | 5% |
| sushi_restaurant | 1 / 19 | 5% |
| korean / colombian / filipino / hot-pot / noodle / tea | 0 / ~50 | ~0% |
| **Asian-cuisine aggregate** | **3 / 176** | **1.7%** |

## The bar paradox = the real bug

Bars almost always have a happy hour. In San Jose: **bar = 4 live / 30, with 25 returning
`no_hh_found`.** That is not "bars without happy hours" — it's extraction failure. A sample
of 22 bar-type `no_hh_found` venues, re-fetched and classified:

| result | count | meaning |
|---|---|---|
| homepage genuinely shows no HH text | 16 | may still have HH on a sub-page/PDF/image (so this is an *upper bound* on "truly none") |
| **HH text was right there, we missed it** | 3 | Paper Plane, Court's Lounge, Bears Cocktail Lounge (2 are Facebook-only pages) |
| **Cloudflare "Just a moment…" bot wall** | 2 | Jack's Restaurant & Bar, Nowhere Bar & Grill |
| **other bot wall** | 1 | AC Lounge (Marriott) |

So **~27% of the bar-type misses are recoverable** (bot-walled or HH-text-present), and the
"genuinely none" 73% is itself inflated (homepage-only check; HH often lives on a sub-page).

## Exemplar: Rise Woodfire (`risewoodfire.com/hh-menu`)

Operator-flagged miss. It *was* a candidate — `serves_alcohol=true`, has the site, was
processed — outcome `no_hh_found`. Cause: **the entire domain is behind Cloudflare's managed
bot challenge.** Every server-side fetch (ours included) gets the "Just a moment… Enable
JavaScript and cookies" interstitial — a ~5KB challenge page with no content and no links.
The HH menu is genuinely there; our fetcher (and a vanilla headless render) can't pass the
wall. This is the single clearest failure mode, and it repeats across bar-type venues.

## Opinions / recommended levers

1. **Don't judge San Jose by raw hit rate.** Segment by HH-eligibility. "% of
   bar/American/gastropub/seafood venues with HH captured" is the real quality metric; the
   live/total ratio is dragged down by ~226 candidates in cuisines + non-alcohol categories
   that can never have HH. The honest read: the *eligible* pool is small here.
2. **An anti-bot fetch tier is now justified — for a measured minority.** Cloudflare/Turnstile
   walls (Rise Woodfire, Jack's, Nowhere, AC Lounge) are exactly the case the self-hosted
   Firecrawl eval dropped — but a *cloud* anti-bot fetch (Firecrawl cloud / ScraperAPI /
   Browserless-stealth), gated to **bar-type + HH-likely** venues only, would recover the
   walled set cheaply. Measure the walled fraction first.
3. **Facebook-page handler or skip.** Several bars are FB-only (Court's Lounge, Bears) with
   HH on the page; FB is login/JS-walled. Either a specific FB parser or an explicit "FB-only,
   route to crowdsource" tag.
4. **Sub-page / PDF / image recall.** The 73% "homepage shows no HH" is overstated — run
   `audit:bare-windows` + image-menu reading (the Bei Sushi eval gap) over the alcohol-serving
   `no_hh_found` set before calling them genuinely dry.

## Bottom line

San Jose is a harder HH city than SF despite adjacency — it's residential-tech + Asian-cuisine
dense, not bar/nightlife dense. The 14% is *mostly* an honest reflection of that mix. But the
bar paradox (4/30) and Rise Woodfire show a real recoverable layer: **bot walls + FB-only +
deep-page HH**. Fixing the anti-bot fetch tier is the highest-leverage next step, and it pays
off in every dense city, not just here.
