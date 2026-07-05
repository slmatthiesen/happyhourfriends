# Santa Cruz — stub review (HH extraction misses)

Generated 2026-07-04. **67 stubs** from the greater-metro expansion push (venues created ≥ 2026-07-02, `data_completeness='stub'` — discovered, no HH extracted).
Goal: find **where/why** HH windows were missed on each.

## How to triage each row
1. Open the URL → look for a happy-hour / specials / drinks page.
2. If HH exists: **`/admin/stubs`** → search the `slug` → paste the HH page URL → re-extract (max-effort).
3. Public page (what we currently show): `https://happyhourfriends.com/ca/santa-cruz/{slug}`
4. If the site is JS-walled and the HH is only in a rendered menu/photo, that's the extractor gap (not a missed URL) — note it.

## Miss-reason tags
- **[DIRECT]** — own HTML site. **Highest yield.** If HH exists here and we missed it, it's an extractor bug (wrong page fetched, signal gate dropped it, or parse failure). Investigate first.
- **[WIX]** / **[FB]** / **[ORDER]** — JS-walled (Wix OOI menu / Facebook / order.online / Toast Tab). Menu renders in JS; extractor sees no HH text. Known gap (`js-walled-sites-and-pdf-menus`).
- **[NO-URL]** — no discoverable site. Nothing to extract; needs a manual URL via Stub Resolver.

**Totals:** 54 DIRECT · 1 WIX · 3 FB · 3 ORDER · 6 NO-URL

---

## Aptos (16)
- [DIRECT] **Aptos St. BBQ** — https://www.aptosstbbq.com/ · `aptos-st-bbq`
- [DIRECT] **Cantine Winepub** — http://www.cantinewinepub.com/ · `cantine-winepub`
- [DIRECT] **Cavalletta** — https://www.cavallettarestaurant.com/ · `cavalletta`
- [DIRECT] **Four Streams Kitchen** — https://www.fourstreamskitchen.com/ · `four-streams-kitchen`
- [DIRECT] **Manuel's Mexican Restaurant** — http://www.manuelsrestaurant.com/ · `manuel-s-mexican-restaurant`
- [DIRECT] **Mentone** — http://www.mentonerestaurant.com/ · `mentone`
- [DIRECT] **Parish Publick House Aptos** — http://www.theparishpublick.com/ · `parish-publick-house-aptos`
- [DIRECT] **Persephone** — http://www.persephonerestaurant.com/ · `persephone`
- [DIRECT] **Pino Alto Restaurant** — http://pinoaltorestaurant.org/ · `pino-alto-restaurant`
- [DIRECT] **Pizza My Heart** — http://www.pizza-1.com/ · `pizza-my-heart-rlfbyc`
- [DIRECT] **Sante Arcangeli Family Wines Aptos Tasting Lounge** — http://www.santewinery.com/ · `sante-arcangeli-family-wines-aptos-tasting-lounge`
- [DIRECT] **Showtime Pizzeria** — http://showtimepizzeria.com/ · `showtime-pizzeria`
- [DIRECT] **Sushi Garden Aptos** — http://www.sushi-garden.com/ · `sushi-garden-aptos`
- [DIRECT] **The Hideout** — http://www.thehideoutaptos.com/ · `the-hideout`
- [DIRECT] **The Mediterranean Bar** — https://www.themediterraneanbar.com/ · `the-mediterranean-bar`
- [DIRECT] **Zameen Mediterranean Cuisine** — http://www.zameencuisine.com/ · `zameen-mediterranean-cuisine`

## Capitola (23)
- [DIRECT] **BrewTopia** — https://brewtopia831.com/ · `brewtopia`
- [FB] **Britannia Arms Of Capitola** — https://m.facebook.com/britanniaarmscapitola/ · `britannia-arms-of-capitola` ⚠ FB-list target
- [WIX] **Caruso's Tuscan Cuisine** — https://carusoscapitola.wixsite.com/carusostuscancusine · `caruso-s-tuscan-cuisine`
- [DIRECT] **Cocoa Vino** — https://www.cocoavinocapitola.com/ · `cocoa-vino`
- [DIRECT] **Cork and Fork Capitola** — http://www.corkandforkcapitola.com/ · `cork-and-fork-capitola`
- [DIRECT] **East End Gastropub** — http://www.eastendgastropub.com/ · `east-end-gastropub`
- [DIRECT] **El Toro Bravo** — http://www.eltorobravocapitola.com/ · `el-toro-bravo`
- [DIRECT] **Evarista's Comal Restaurant** — https://evaristascomal.com/ · `evarista-s-comal-restaurant`
- [DIRECT] **Fast Eddy's Billiards** — http://fasteddysbilliards.net/ · `fast-eddy-s-billiards`
- [ORDER] **KAITO** — https://order.online/store/Kaito-591846 · `kaito`
- [DIRECT] **Miyako Japanese Restaurant** — https://miyakocapitola.com/ · `miyako-japanese-restaurant`
- [DIRECT] **Paradise Beach Grille** — http://paradisebeachgrille.com/ · `paradise-beach-grille`
- [DIRECT] **Pizza My Heart** — https://www.pizzamyheart.com/ · `pizza-my-heart-dvlp6k`
- [DIRECT] **Pizza My Heart** — https://www.pizzamyheart.com/ · `pizza-my-heart-qe5arw`  *(dup of above — different Google entity?)*
- [DIRECT] **Pono Hawaiian Kitchen & Tap** — http://www.ponohawaiiangrill.com/ · `pono-hawaiian-kitchen-tap`
- [DIRECT] **Sante Adairius Rustic Ales** — http://www.rusticales.com/ · `sante-adairius-rustic-ales`
- [DIRECT] **Shadowbrook Restaurant** — https://www.shadowbrook-capitola.com/ · `shadowbrook-restaurant` ⚠ FB-list target
- [DIRECT] **Taquizas Gabriel LLC** — https://taquizas-gabriel.com/ · `taquizas-gabriel-llc`
- [DIRECT] **Trestles Restaurant** — http://www.trestlesrestaurant.com/ · `trestles-restaurant`
- [DIRECT] **Vin Vivant Wine Bar & Bottle Shop** — https://www.vinvivantcapitola.com/ · `vin-vivant-wine-bar-bottle-shop`
- [DIRECT] **Wasabi Sushi** — https://www.wasabisushisc.com/ · `wasabi-sushi`
- [NO-URL] **Avenue Cafe** · `avenue-cafe`
- [NO-URL] **Yakitori Toriman** · `yakitori-toriman`

## Live Oak (1)
- [ORDER] **El Chino Mexican Restaurant** — https://www.toasttab.com/el-chino-mexican-restaurant · `el-chino-mexican-restaurant`

## Opal Cliffs (12)
- [DIRECT] **Canton Restaurant** — http://www.cantonsantacruz.com/ · `canton-restaurant-rotel8`
- [DIRECT] **Castaways** — http://castaways.bar/ · `castaways`
- [DIRECT] **Cole's Bar-B-Q** — http://www.colesbbq.com/ · `cole-s-bar-b-q`
- [DIRECT] **Dynasty Restaurant** — http://www.dynastysantacruz.com/ · `dynasty-restaurant`
- [DIRECT] **Guang Zho** — https://guangzhotogo.com/ · `guang-zho`
- [DIRECT] **La Jaiba Brava Restaurant** — https://lajaibabravarestaurantca.com/ · `la-jaiba-brava-restaurant`
- [DIRECT] **Over the Hill Gang Saloon** — http://othgs.com/ · `over-the-hill-gang-saloon`
- [DIRECT] **Pleasure Pizza East Side Eatery** — http://pleasurepizzasc.com/ · `pleasure-pizza-east-side-eatery`
- [DIRECT] **Süda** — http://www.eatsuda.com/ · `suda` ⚠ FB-list target
- [DIRECT] **The Point | Kitchen and Bar** — http://www.thepointkitchenandbar.com/ · `the-point-kitchen-and-bar`
- [DIRECT] **Zameen At The Point** — http://www.zameencuisine.com/ · `zameen-at-the-point`  *(shares zameencuisine.com with the Aptos Zameen — same group?)*
- [NO-URL] **Oak & Ale** · `oak-ale`

## Rio del Mar (4)
- [DIRECT] **Bittersweet Bistro** — https://bittersweetbistro.com/ · `bittersweet-bistro`
- [DIRECT] **Dos Pescados** — https://dospescados.com/ · `dos-pescados`
- [DIRECT] **Panda Inn** — https://www.pandainntogo.com/ · `panda-inn`
- [ORDER] **Village Host Pizza & Grill** — https://order.toasttab.com/online/villagehostpizza-aptos · `village-host-pizza-grill`

## Soquel (10)
- [DIRECT] **Beer Thirty Bottle Shop & Pour House** — http://www.beerthirtysantacruz.com/ · `beer-thirty-bottle-shop-pour-house`
- [DIRECT] **Buzzo's Wood Fired Pizzeria** — https://www.buzzopizza.com/ · `buzzo-s-wood-fired-pizzeria`
- [DIRECT] **Carpo's Restaurant** — https://carposrestaurant.com/ · `carpo-s-restaurant`
- [DIRECT] **Discretion Brewing** — http://www.discretionbrewing.com/ · `discretion-brewing`
- [DIRECT] **Fuji Sushi** — https://www.fujisoquel.com/ · `fuji-sushi`
- [DIRECT] **HOME** — http://www.homesoquel.com/ · `home`
- [FB] **Sir Froggy's** — https://m.facebook.com/SirFroggysPub/ · `sir-froggy-s`
- [NO-URL] **Golden Fu Wah Restaurant / Fuji Sushi** · `golden-fu-wah-restaurant-fuji-sushi`  *(shares name w/ Fuji Sushi above — possible dup)*
- [NO-URL] **JJ's Saloon and Social Club** · `jj-s-saloon-and-social-club`
- [NO-URL] **Ming's Palace Restaurant** · `ming-s-palace-restaurant`

## Twin Lakes (1)
- [FB] **Aloha Island Grille** — https://www.facebook.com/alohaislandgrille/ · `aloha-island-grille`

---

## Also: 6 pre-existing known-HH stubs (FB-list, not in the new-67)
Created before 2026-07-02 — reextracted 2026-07-04, all came back conf 0.00 (JS-walled). Highest-priority for manual URL hunt:
- `stagnaro-bros-seafood-inc` — https://www.stagnarobrothers.com/ (Wix OOI menu)
- `venus-spirits-cocktails-kitchen-westside` — https://www.venusspirits.com/…
- `venus-spirits-tasting-room` — https://www.venusspirits.com/…
- `jack-o-neill-restaurant-lounge` · `aldo-s` · `low-tide-bar-grill`

## Suspected duplicates worth checking
- **Pizza My Heart** ×3 (Aptos `pizza-my-heart-rlfbyc`, Capitola `pizza-my-heart-dvlp6k` + `pizza-my-heart-qe5arw`) — two Capitola entries share `pizzamyheart.com`; one may be a Google Places dup. Pizza My Heart is a chain (real, keep) but verify the two Capitola pins aren't the same location.
- **Zameen** ×2 (Aptos `zameen-mediterranean-cuisine` + Opal Cliffs `zameen-at-the-point`) — both `zameencuisine.com`; "At The Point" may be a second outlet (keep both if distinct addresses) or a dup.
- **Fuji Sushi** ×2 (Soquel `fuji-sushi` + `golden-fu-wah-restaurant-fuji-sushi`) — the latter's name suggests it's the old "Golden Fu Wah" re-listed; possible dup.
