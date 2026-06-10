# Happy-hour realness audit worksheet — 2026-06-01

Branch `cluster-schema-seed-pipeline`. Generated from the live DB. 59 flagged windows.
Goal: open each **source** link, see what the venue actually advertises, then fill DECISION,
whether the flag was RIGHT (this tunes which signals the gate should trust), and NOTES.

DECISION codes:

- **keep**         — real HH, correctly shown → leave live
- **delete**       — this window is not a real HH (coupon / junk / duplicate) → remove the window
- **delete-venue** — the whole venue shouldn't be listed → remove venue
- **correct**      — real HH but wrong data → write the right value in NOTES (e.g. "Mon–Fri 16:00–18:00")
- **reextract**    — real HH but missing deals/details → queue a re-pull
- **hide**         — keep stored, off the site, undecided

"flag was right? Y/N" = was the signal correct to flag this row? (Y = true positive, N = false positive).
Tallying these tells us which signals to keep as hide rules vs. drop.

Already handled this session (for reference): Iron Chef (coupon) → deleted; The Vig → 2 spurious
all-day rows deleted, real 16:00–18:00 kept.

---

## Signal scorecard (fill the "right?" column above, then we tally here)

| signal            | rows flagged | true positives | false positives |
| ----------------- | ------------ | -------------- | --------------- |
| all-day-3+days    | 6            |                |                 |
| aggregator-source | 22           |                |                 |
| coupon-source     | 0            |                |                 |
| zero-offerings    | 31           |                |                 |

---

## Group A — flagged by DAY-COUNT (all-day on 3+ days) — suspected OVER-HIDING

_(6 rows)_

- [ ] **Babbo Italian Eatery** (phoenix-central) · `a96e2045-4591-4bd6-a32a-17c9d9f93aff`
  shows now: **ALL-DAY**, Thu,Fri,Sat,Sun · 8 offering(s) · flags: all-day-3+days
  check the real HH → source: https://babboitalian.com/happy-hour.php
  our page: https://happyhourfriends.com/phoenix-central/venue/babbo-italian-eatery
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Sicilian Butcher** (phoenix-central) · `cabb86bc-78b7-4fc1-9739-dfc51df479ee`
  shows now: **ALL-DAY**, Mon,Tue,Wed,Thu,Sun · 4 offering(s) · flags: all-day-3+days
  check the real HH → source: https://www.arizonafoothillsmagazine.com/taste/restaurants-phoenix/the-sicilian-butcher-brings-the-flavors-of-sicily-to-the-valley
  our page: https://happyhourfriends.com/phoenix-central/venue/the-sicilian-butcher
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Orangedale Lounge** (scottsdale) · `3b12b6f1-a92d-40b9-89f2-c6ef075a988e`
  shows now: **ALL-DAY**, every day · 1 offering(s) · flags: all-day-3+days
  check the real HH → source: http://www.orangedalelounge.com/
  our page: https://happyhourfriends.com/scottsdale/venue/orangedale-lounge
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Pattie's First Avenue Lounge** (scottsdale) · `23f8981f-b532-40d7-a0c0-b1adde4c4670`
  shows now: **ALL-DAY**, every day · 1 offering(s) · flags: all-day-3+days
  check the real HH → source: https://nextdoor.com/pages/patties-first-avenue-lounge-scottsdale-az/
  our page: https://happyhourfriends.com/scottsdale/venue/pattie-s-first-avenue-lounge
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Italiano by Chef Joey** (scottsdale) · `d3452efc-4263-47d7-8931-e3f1ed939e8f`
  shows now: **ALL-DAY**, every day · 8 offering(s) · flags: all-day-3+days
  check the real HH → source: https://www.theitaliano.com/s/Italiano_Lounge20Menu20_Rev201-9-2620FINAL-compressed.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/the-italiano-by-chef-joey
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Mexicano by Chef Joey** (scottsdale) · `b7cf2adc-6b8e-4e90-beb5-1b5e1d8808fe`
  shows now: **ALL-DAY**, every day · 8 offering(s) · flags: all-day-3+days
  check the real HH → source: https://www.themexicano.com/s/Mexicano-Menu_Bar-HH_Rev-4-21-26.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/the-mexicano-by-chef-joey
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________

---

## Group C — AGGREGATOR / COUPON SOURCE (provenance — not first-party)

_(22 rows)_

- [ ] **Dubliner Irish Pub** (phoenix-central) · `788729e7-d63a-4bd9-8799-9adbf04be9da`
  shows now: **ALL-DAY**, Wed · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `59cec010-ef4b-4790-8ee1-670a11625951`
  shows now: **ALL-DAY**, Fri · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `2352e4d8-1157-4883-ab1b-977973e0dc2b`
  shows now: **ALL-DAY**, Sat · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `cb090240-ef6e-4e58-bbb1-5062029e8f3f`
  shows now: **20:00–23:00**, Tue · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `b667464e-dbfd-4958-977c-b218ae49fa68`
  shows now: **ALL-DAY**, Sun · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `3d91ab57-6e47-45e6-bb18-27f9f294d3bd`
  shows now: **21:00–02:00**, Thu · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `786cd41b-5463-4e41-9ed6-0cc1bd2b1e33`
  shows now: **20:00–23:00**, Wed · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `a0449596-d771-4f9d-a133-a3d05804d137`
  shows now: **16:00–19:00**, Mon,Tue,Wed,Thu,Fri,Sat · 4 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dubliner Irish Pub** (phoenix-central) · `52c1332a-9105-43e9-b49b-1514518afb9d`
  shows now: **23:00–close**, Mon,Tue,Wed,Thu,Fri,Sat · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **18 Degrees** (scottsdale) · `49ff37ef-8f96-4ce4-9e9d-4c32ec347c6a`
  shows now: **15:00–19:00**, Mon,Tue,Wed,Thu,Fri · 7 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/scottsdale/18-degrees/
  our page: https://happyhourfriends.com/scottsdale/venue/18-degrees
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **18 Degrees** (scottsdale) · `b9467ac0-0fe6-494f-9479-e094b61501a3`
  shows now: **21:00–23:00**, Mon,Tue,Wed,Thu,Fri · 3 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/scottsdale/18-degrees/
  our page: https://happyhourfriends.com/scottsdale/venue/18-degrees
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Ernie's** (scottsdale) · `6b29bfd4-fe4d-42e7-92a0-c377b02f72e2`
  shows now: **14:00–19:00**, every day · 3 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/scottsdale/ernies/
  our page: https://happyhourfriends.com/scottsdale/venue/ernie-s
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Handlebar J** (scottsdale) · `d5fa7d61-0e9d-4bd2-806a-1498bddb7777`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri · 4 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/scottsdale/handlebar-j-restaurant-and-bar/
  our page: https://happyhourfriends.com/scottsdale/venue/handlebar-j
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Guillermo's Double L** (tucson) · `6774bf89-50f5-4154-9b75-94b9ddaab552`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri,Sat · 2 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/south-tucson/guillermos-double-l-restaurant/
  our page: https://happyhourfriends.com/tucson/venue/guillermo-s-double-l
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Kon Tiki Restaurant & Lounge** (tucson) · `38da265f-1cbf-4fde-858a-e23ea3bbe3e6`
  shows now: **16:00–19:00**, Mon,Tue,Wed,Thu,Fri · 2 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/kon-tiki-restaurant-lounge/
  our page: https://happyhourfriends.com/tucson/venue/kon-tiki-restaurant-lounge
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Ole' Mexican Grill** (tucson) · `485b5ba7-02be-4b80-9bef-90e46d87e1b8`
  shows now: **14:00–19:00**, Mon,Tue,Wed,Thu,Fri · 4 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/ole-mexican-grill/
  our page: https://happyhourfriends.com/tucson/venue/ole-mexican-grill
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Red Garter Saloon Bar & Grill** (tucson) · `ed22dc09-a0bf-41ce-a195-ae5ad97d1715`
  shows now: **16:00–19:00**, Mon,Tue,Wed,Thu,Fri · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/red-garter-saloon/
  our page: https://happyhourfriends.com/tucson/venue/red-garter-saloon-bar-grill
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Rocco's Little Chicago** (tucson) · `6638c5f6-4bed-47ee-bd8a-c60ddffa1f71`
  shows now: **17:00–21:00**, Wed · 1 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/roccos-little-chicago/
  our page: https://happyhourfriends.com/tucson/venue/rocco-s-little-chicago
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Rusty's Family Restaurant & Sports Grille** (tucson) · `f09d0dd0-9e9b-4751-858f-f5a8c6df21f1`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri · 3 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/rustys-family-restaurant-sports-grille/
  our page: https://happyhourfriends.com/tucson/venue/rusty-s-family-restaurant-sports-grille
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Rusty's Family Restaurant & Sports Grille** (tucson) · `fbb72b57-6a12-4e5e-9e71-eeadf8b40fa6`
  shows now: **22:00–00:00**, Mon,Tue,Wed,Thu,Fri · 3 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/rustys-family-restaurant-sports-grille/
  our page: https://happyhourfriends.com/tucson/venue/rusty-s-family-restaurant-sports-grille
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Sushi Garden** (tucson) · `b24ed861-1eaf-4344-aac8-4bf02021e9a9`
  shows now: **22:00–23:59**, Fri,Sat · 4 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/sushi-garden-north/
  our page: https://happyhourfriends.com/tucson/venue/sushi-garden
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Sushi Garden** (tucson) · `3d3481a0-9563-4c20-a132-cbf86427bd01`
  shows now: **16:00–19:00**, Mon,Tue,Wed,Thu,Sun · 4 offering(s) · flags: aggregator-source
  check the real HH → source: https://thehappyhourfinder.com/us_az/tucson/sushi-garden-north/
  our page: https://happyhourfriends.com/tucson/venue/sushi-garden
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________

---

## Group B — ZERO OFFERINGS (time captured, but no deals)

_(31 rows)_

- [ ] **Base Pizzeria** (phoenix-central) · `33d7f544-e347-46d0-a393-b5ed7ff231de`
  shows now: **14:00–17:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.instagram.com/base_pizzeria/
  our page: https://happyhourfriends.com/phoenix-central/venue/base-pizzeria
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Dilla Libre Uno** (phoenix-central) · `5592d150-2864-4b84-84f0-e2662acbd417`
  shows now: **ALL-DAY**, Thu · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://dillalibre.com/our-menu/
  our page: https://happyhourfriends.com/phoenix-central/venue/dilla-libre-uno
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Kitsune Brewing Company** (phoenix-central) · `4e121698-e3ea-497d-8b2a-79aacb12eb59`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://brewerybible.com/breweries/united-states/arizona/phoenix/kitsune-brewing-company/
  our page: https://happyhourfriends.com/phoenix-central/venue/kitsune-brewing-company
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Orchard Tavern** (phoenix-central) · `742bdb36-286a-41d2-bf62-0812f465ea03`
  shows now: **15:00–18:00**, Tue,Wed,Thu,Fri,Sat,Sun · 0 offering(s) · flags: zero-offerings
  check the real HH → source: http://www.orchardtavernphx.com/ot-menus
  our page: https://happyhourfriends.com/phoenix-central/venue/orchard-tavern
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **ROSSO ITALIAN** (phoenix-central) · `f6c05b2f-4bd6-4b17-9cec-8800cd1ef61f`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://rossoitalian.com/menu/22514871-3c74-496d-b14c-a4dee3c750b1
  our page: https://happyhourfriends.com/phoenix-central/venue/rosso-italian
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Spinato's Pizzeria and Family Kitchen** (phoenix-central) · `5b9d26d8-eca7-4e37-bcbf-ac244076bbe5`
  shows now: **11:00–18:00**, every day · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.spinatospizzeria.com/happy-hour-phoenix-az
  our page: https://happyhourfriends.com/phoenix-central/venue/spinato-s-pizzeria-and-family-kitchen
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Taco Guild** (phoenix-central) · `7a15a96e-b44f-4061-b228-2a65c0280f58`
  shows now: **14:00–18:00**, every day · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://tacoguild.com/happy-hours-specials
  our page: https://happyhourfriends.com/phoenix-central/venue/taco-guild
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Taco Guild** (phoenix-central) · `4835b734-4922-4d23-b599-6ea268c31473`
  shows now: **20:00–23:00**, Sat,Sun · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://tacoguild.com/happy-hours-specials
  our page: https://happyhourfriends.com/phoenix-central/venue/taco-guild
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Taco Guild** (phoenix-central) · `074068ea-5fc9-4721-8e91-ecbcc167423e`
  shows now: **20:00–22:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://tacoguild.com/happy-hours-specials
  our page: https://happyhourfriends.com/phoenix-central/venue/taco-guild
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Beaver Bar** (phoenix-central) · `bc26b6b3-1a34-4df3-a69e-6e7439d7e425`
  shows now: **14:00–19:00**, every day · 0 offering(s) · flags: zero-offerings
  check the real HH → source: http://www.thebeaverbarphxaz.com/
  our page: https://happyhourfriends.com/phoenix-central/venue/the-beaver-bar
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Cheesecake Factory** (phoenix-central) · `c08de8cc-b831-4311-bb02-9d86873c5cd4`
  shows now: **16:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://locations.thecheesecakefactory.com/az/phoenix-42.html?utm_source=Google&utm_medium=Maps&utm_campaign=Google+Places
  our page: https://happyhourfriends.com/phoenix-central/venue/the-cheesecake-factory
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Wren & Wolf** (phoenix-central) · `0e4a60ac-b9ff-4cc3-84f6-a9fe423b9c91`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://fabulousarizona.com/food-drink/wren-wolf-phoenix/
  our page: https://happyhourfriends.com/phoenix-central/venue/wren-wolf
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **CAZ Sports Bar** (scottsdale) · `6786d34a-4b8d-4d5d-9d69-d804e2453a0b`
  shows now: **14:00–17:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.casinoarizona.com/dining/caz-sports-bar/
  our page: https://happyhourfriends.com/scottsdale/venue/caz-sports-bar
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Farm and Craft Scottsdale** (scottsdale) · `684b0076-616c-4026-a5b1-41b37acd8622`
  shows now: **14:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://ilovefarmandcraft.com/
  our page: https://happyhourfriends.com/scottsdale/venue/farm-and-craft-scottsdale
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Ling & Louie's Asian Bar and Grill** (scottsdale) · `e9ac0cd7-d5c8-4904-8a04-d6c2dd9c476a`
  shows now: **15:00–19:00**, every day · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.lingandlouies.com/happy-hour-scottsdale
  our page: https://happyhourfriends.com/scottsdale/venue/ling-louie-s-asian-bar-and-grill
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Mastro's City Hall** (scottsdale) · `912ae660-3817-401c-afd2-f519b1af1068`
  shows now: **16:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.mastrosrestaurants.com/specials/
  our page: https://happyhourfriends.com/scottsdale/venue/mastro-s-city-hall
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Mastro's Ocean Club** (scottsdale) · `5e3dd5be-d3ff-4aa7-b63c-9e05bde0e441`
  shows now: **16:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.mastrosrestaurants.com/specials/
  our page: https://happyhourfriends.com/scottsdale/venue/mastro-s-ocean-club
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Rossa Kitchen & Patio** (scottsdale) · `a04ce6f0-738b-4006-aa9a-84d2e8c213d9`
  shows now: **14:00–17:00**, every day · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://arcisgolf.com/clubs/mcdowell-mountain-golf-club/rossas-kitchen-and-patio
  our page: https://happyhourfriends.com/scottsdale/venue/rossa-kitchen-patio
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Shio Ramen & Crudo** (scottsdale) · `296ef93e-8c8d-4416-9f92-eee6bd737d78`
  shows now: **16:30–close**, Mon,Tue,Wed,Thu,Fri,Sat · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://shio-ramen-crudo.wheree.com/
  our page: https://happyhourfriends.com/scottsdale/venue/shio-ramen-crudo
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Sophia's Kitchen** (scottsdale) · `4e5993c2-52cd-4f2e-9a44-31e2e4dbc453`
  shows now: **11:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.sophiaskitchen.com/
  our page: https://happyhourfriends.com/scottsdale/venue/sophia-s-kitchen
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Cheesecake Factory** (scottsdale) · `daf192a6-cd2b-413f-b046-6deeb01b5a49`
  shows now: **16:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://locations.thecheesecakefactory.com/az/scottsdale-36.html?utm_source=Google&utm_medium=Maps&utm_campaign=Google+Places
  our page: https://happyhourfriends.com/scottsdale/venue/the-cheesecake-factory
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Tommy Bahama Restaurant & Bar** (scottsdale) · `878dfb02-6453-438b-83d5-aa7278bb23f5`
  shows now: **15:00–17:00**, every day · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.tommybahama.com/restaurants-and-marlin-bars/locations/scottsdale
  our page: https://happyhourfriends.com/scottsdale/venue/tommy-bahama-restaurant-bar
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Airport Tavern Music Hall** (tacoma) · `5eebd5ed-44b9-405c-953f-c4bab095a6db`
  shows now: **16:00–18:00**, Tue,Wed,Thu,Fri,Sat,Sun · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.airporttavern.com/
  our page: https://happyhourfriends.com/tacoma/venue/airport-tavern-music-hall
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Cheesecake Factory** (tacoma) · `5b95eda9-9bb0-41dc-8104-160b6fe9ba7c`
  shows now: **16:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://locations.thecheesecakefactory.com/wa/tacoma-199.html?utm_source=Google&utm_medium=Maps&utm_campaign=Google+Places
  our page: https://happyhourfriends.com/tacoma/venue/the-cheesecake-factory
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Woven Seafood & Chophouse** (tacoma) · `3264861f-05d3-4985-adc8-5c6f8066ec8d`
  shows now: **14:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://eatwoven.com/
  our page: https://happyhourfriends.com/tacoma/venue/woven-seafood-chophouse
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **CORBETT'S** (tucson) · `9ac7f140-52c1-48d0-b4ff-e1e035681702`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://fourthavenue.org/merchant-listings/corbetts/
  our page: https://happyhourfriends.com/tucson/venue/corbett-s
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **El Sur Mexican Restaurant** (tucson) · `e36bc691-2818-4534-82d4-cd427a37e5b4`
  shows now: **16:00–18:00**, Mon,Tue,Wed,Thu · 0 offering(s) · flags: zero-offerings
  check the real HH → source: http://www.elsurmexicanrestaurant.com/
  our page: https://happyhourfriends.com/tucson/venue/el-sur-mexican-restaurant
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Mojo Cuban Kitchen and Rum Bar** (tucson) · `3207dc76-fed8-4877-835f-0fe0d765d898`
  shows now: **15:00–17:30**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.mojocuban.com/menu/
  our page: https://happyhourfriends.com/tucson/venue/mojo-cuban-kitchen-and-rum-bar
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Native Grill & Wings** (tucson) · `6f3dc8b9-ec42-4906-9de2-db4e49cea0b6`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://locations.nativegrillandwings.com/ll/US/AZ/Tucson/5421-South-Calle-Santa-Cruz
  our page: https://happyhourfriends.com/tucson/venue/native-grill-wings
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **Passagio** (tucson) · `7a0ff31c-b2c6-4985-9506-dfff9d44bac0`
  shows now: **17:00–19:00**, Thu,Fri,Sat · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://www.opentable.com/r/jw-marriott-starr-pass-passaggio-tucson
  our page: https://happyhourfriends.com/tucson/venue/passagio
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
- [ ] **The Cheesecake Factory** (tucson) · `f004913b-cc10-4737-8835-9e2870140713`
  shows now: **16:00–18:00**, Mon,Tue,Wed,Thu,Fri · 0 offering(s) · flags: zero-offerings
  check the real HH → source: https://locations.thecheesecakefactory.com/az/tucson-150.html?utm_source=Google&utm_medium=Maps&utm_campaign=Google+Places
  our page: https://happyhourfriends.com/tucson/venue/the-cheesecake-factory
  ► is it a real recurring HH? ___   times/days right? ___   source first-party? ___
  ► DECISION: ____________   (flag was right? Y/N: ___)   NOTES: ________________________________
