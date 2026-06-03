# Happy-hour DATA-VALIDITY worksheet — 2026-06-01

Branch `cluster-schema-seed-pipeline`. Generated from the live DB.

**The question this sheet answers:** for windows we currently show as LIVE, is the deal we stored specific enough that a visitor could actually trust it and act on it? The trigger case was **Valentine (phoenix-central)** — *"all day" + "natural wines"*, no price, Yelp source. That kind of row is closer to a stub than a usable happy hour.

**Selection (strict bar, operator-chosen 2026-06-01):** active (publicly-shown) windows that have ≥1 offering but **no offering carries a dollar price AND the deal text contains no discount figure** (no `$`, `%`, `half`, `1/2`, `free`). That is 114 windows. Windows with zero offerings live in the separate realness audit and are NOT repeated here.

**Ranked by _content words_** — deal-text words left after stripping filler (`happy`, `hour`, `specials`, `drinks`, `details`, `not specified`, …). The fewer the content words, the closer to empty.

DECISION codes:
- **real-keep** — deal really is this vague but it's a real HH → leave live (accept low detail)
- **add-prices** — real HH, we just failed to capture the item/price detail → re-extract (NOT a stub)
- **stub** — not specific/real enough to show → drop the window, keep venue as a help-wanted stub
- **correct** — real HH but wrong days/time → write the right value in NOTES
- **delete-venue** — whole venue shouldn't be listed


| tier | meaning | rows |
| --- | --- | --- |
| A | near-empty — a bare category, ~0–2 content words (the "two words" case) | 60 |
| B | vague filler — 3–5 content words, no concrete item or price | 20 |
| C | has named items, just NO prices — likely **add-prices**, not stub | 34 |


---

## Tier A — near-empty deal (the Valentine class) — review first

_60 rows. A bare item category or pure "happy hour specials" filler — nothing a visitor can act on._

- [ ] **Kimmyz Tatum Point** (phoenix-central) · `6dd5a48d-65d2-4596-86db-d5abc66ca643`
  shows now: **11:00–18:00**, every day · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour drinks_
  source: https://www.alignable.com/phoenix-az/kimmyz-tatum-point-2/happy-hour
  our page: https://happyhourfriends.com/phoenix-central/venue/kimmyz-tatum-point
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Arena Sports Grill** (scottsdale) · `8cf85c4e-e023-489f-a8f3-e9516af99e88`
  shows now: **13:30–19:00**, Mon · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour drinks and specials Specific drinks and pricing not detailed on current website_
  source: https://arenasportsgrills.com/scottsdale-arena-sports-grill-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/arena-sports-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Arena Sports Grill** (scottsdale) · `a7cd3649-5d97-401b-a04c-6e5e093dcc5f`
  shows now: **14:00–19:00**, Wed · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour drinks and specials Specific drinks and pricing not detailed on current website_
  source: https://arenasportsgrills.com/scottsdale-arena-sports-grill-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/arena-sports-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Arena Sports Grill** (scottsdale) · `c1738a2c-5b52-4c18-9a00-791665654195`
  shows now: **14:00–19:00**, Tue · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour drinks and specials Specific drinks and pricing not detailed on current website_
  source: https://arenasportsgrills.com/scottsdale-arena-sports-grill-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/arena-sports-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Arena Sports Grill** (scottsdale) · `dde0386b-ed25-4046-999e-648de9ed5cf7`
  shows now: **14:00–19:00**, Fri · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour drinks and specials Specific drinks and pricing not detailed on current website_
  source: https://arenasportsgrills.com/scottsdale-arena-sports-grill-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/arena-sports-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Arena Sports Grill** (scottsdale) · `fcf19f6e-5818-44fc-81f5-f3c8616474f6`
  shows now: **14:00–19:00**, Thu · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour drinks and specials Specific drinks and pricing not detailed on current website_
  source: https://arenasportsgrills.com/scottsdale-arena-sports-grill-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/arena-sports-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dirty Dogg Saloon** (scottsdale) · `657e1b2d-044f-435b-aa77-82e043668f4c`
  shows now: **15:00–20:00**, Tue,Wed,Thu,Fri,Sat · 1 offering(s) · content-words: 0
  deal text we store: _Drink specials Unspecified drink specials during happy hour_
  source: http://dirtydoggsaloon.com/
  our page: https://happyhourfriends.com/scottsdale/venue/dirty-dogg-saloon
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Giligin's** (scottsdale) · `61a7e54c-fefb-499c-ac21-a001beeb38ec`
  shows now: **16:00–19:00**, Mon–Fri · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour drinks See menu for current drink specials and pricing_
  source: http://giliginsbar.com/happyhour.html
  our page: https://happyhourfriends.com/scottsdale/venue/giligin-s
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Giligin's** (scottsdale) · `83805686-b80b-4950-b24f-e63f4cdcc0e4`
  shows now: **15:00–18:00**, Sat,Sun · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour drinks See menu for current drink specials and pricing_
  source: http://giliginsbar.com/happyhour.html
  our page: https://happyhourfriends.com/scottsdale/venue/giligin-s
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **HULA'S Modern Tiki Scottsdale** (scottsdale) · `0a02f566-bb99-4e07-bb01-cd2a3cb2725d`
  shows now: **22:00–00:00**, Fri · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drink Specials_
  source: https://www.hulasmoderntiki.com/s/HULAS-DRINKS-WEB-01_20_26-t86y.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/hula-s-modern-tiki-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **HULA'S Modern Tiki Scottsdale** (scottsdale) · `573b210c-35e6-4aba-91ed-c84c7afc52fc`
  shows now: **10:30–15:30**, Sun · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drink Specials_
  source: https://www.hulasmoderntiki.com/s/HULAS-DRINKS-WEB-01_20_26-t86y.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/hula-s-modern-tiki-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **HULA'S Modern Tiki Scottsdale** (scottsdale) · `81c3f7c0-724c-489a-8b20-221002e653b4`
  shows now: **22:00–00:00**, Sat · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drink Specials_
  source: https://www.hulasmoderntiki.com/s/HULAS-DRINKS-WEB-01_20_26-t86y.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/hula-s-modern-tiki-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Orangedale Lounge** (scottsdale) · `25759b59-b30c-43e0-9c1c-ca5eb40c7d0c`
  shows now: **22:00–close**, Mon,Tue,Wed,Thu · 1 offering(s) · content-words: 0
  deal text we store: _All drinks_
  source: http://www.orangedalelounge.com/
  our page: https://happyhourfriends.com/scottsdale/venue/orangedale-lounge
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Orangedale Lounge** (scottsdale) · `e8bce812-9124-463d-b150-08bd5258e1a6`
  shows now: **13:00–14:00**, Mon–Fri · 1 offering(s) · content-words: 0
  deal text we store: _All drinks_
  source: http://www.orangedalelounge.com/
  our page: https://happyhourfriends.com/scottsdale/venue/orangedale-lounge
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Salt and Lime Shea** (scottsdale) · `547bca60-82d6-4f39-9811-3b5a86692bc1`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri,Sat · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Specials_
  source: https://www.saltandlimeaz.com/shea
  our page: https://happyhourfriends.com/scottsdale/venue/salt-and-lime-shea
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Salt and Lime Shea** (scottsdale) · `b9d61778-0135-45f9-994f-a97acb1a1253`
  shows now: **ALL-DAY**, Sun · 1 offering(s) · content-words: 0
  deal text we store: _All Day Happy Hour_
  source: https://www.saltandlimeaz.com/shea
  our page: https://happyhourfriends.com/scottsdale/venue/salt-and-lime-shea
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Sushi Crush** (scottsdale) · `18158c04-b3f8-434c-a22d-dc62dd692315`
  shows now: **14:00–22:30**, Tue,Wed,Thu,Fri · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drinks & Food Specials Happy hour specials available - see Happy Hour menu for details_
  source: https://sushicrushaz.com/scottsdale-sushi-crush-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/sushi-crush
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Sushi Crush** (scottsdale) · `4f215f38-7ce0-4dd9-9114-b7513d571f80`
  shows now: **12:00–21:00**, Sun · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drinks & Food Specials Happy hour specials available - see Happy Hour menu for details_
  source: https://sushicrushaz.com/scottsdale-sushi-crush-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/sushi-crush
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Sushi Crush** (scottsdale) · `591c5b04-7fea-4fc0-98f9-719586af7ea4`
  shows now: **14:00–23:00**, Sat · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drinks & Food Specials Happy hour specials available - see Happy Hour menu for details_
  source: https://sushicrushaz.com/scottsdale-sushi-crush-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/sushi-crush
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Sushi Crush** (scottsdale) · `7a407610-0f13-4f35-accb-21be390f0a59`
  shows now: **14:00–22:30**, Mon · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drinks & Food Specials Happy hour specials available - see Happy Hour menu for details_
  source: https://sushicrushaz.com/scottsdale-sushi-crush-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/sushi-crush
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Taco Papi** (scottsdale) · `fd170253-6fa2-4771-be66-3435d3d6dcf0`
  shows now: **15:00–17:00**, every day · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Drinks Happy hour specials on drinks_
  source: https://www.tacopapi.com/happy-hour
  our page: https://happyhourfriends.com/scottsdale/venue/taco-papi
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Tacoma Comedy Club** (tacoma) · `8f37e3a8-0e67-4835-8b4d-9969dac03f47`
  shows now: **00:00–close**, Wed · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour pricing on drinks_
  source: https://www.tacomacomedyclub.com/pages/specials
  our page: https://happyhourfriends.com/tacoma/venue/tacoma-comedy-club
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Tacoma Comedy Club** (tacoma) · `e636358c-bf9c-4dc5-bd1b-3138835110e5`
  shows now: **00:00–close**, Thu,Sun · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour specials_
  source: https://www-tacomacomedyclub-com.seatengine.com/pages/specials-menu
  our page: https://happyhourfriends.com/tacoma/venue/tacoma-comedy-club
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Empire Pizza & Pub** (tucson) · `13895221-0d45-48ea-a00e-45f66e3ab105`
  shows now: **ALL-DAY**, Sun · 1 offering(s) · content-words: 0
  deal text we store: _Daily Drink Specials_
  source: http://www.empire.pizza/
  our page: https://happyhourfriends.com/tucson/venue/empire-pizza-pub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Empire Pizza & Pub** (tucson) · `d287804b-6370-47bd-b141-13025b24cebb`
  shows now: **16:00–19:00**, Mon,Tue,Wed,Thu,Fri,Sat · 1 offering(s) · content-words: 0
  deal text we store: _Daily Drink Specials_
  source: http://www.empire.pizza/
  our page: https://happyhourfriends.com/tucson/venue/empire-pizza-pub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Hideout: The Original** (tucson) · `94c4738c-2ae9-49e5-ab22-b3098f697d3d`
  shows now: **16:00–18:00**, Mon–Fri · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour specials (specific items and prices not detailed in available sources)_
  source: https://tucson.com/entertainment/music/the-original-hideout/article_2355cc1f-e6d2-52f2-ae62-7157851e85d1.html
  our page: https://happyhourfriends.com/tucson/venue/hideout-the-original
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **JoJo's Restaurant** (tucson) · `735c710d-40e0-404c-95a5-79b5738c8671`
  shows now: **15:00–17:00**, Tue,Wed,Thu,Fri,Sat · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour drinks Happy hour drinks and specials (specific offerings not detailed on accessible source pages)_
  source: https://www.opentable.com/r/jojos-restaurant-tucson
  our page: https://happyhourfriends.com/tucson/venue/jojo-s-restaurant
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **La Indita Restaurant** (tucson) · `eec9ba28-a68a-44d8-871e-dd50c0ca6e5d`
  shows now: **15:00–18:30**, every day · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour drinks Happy hour pricing_
  source: https://www.yelp.com/search?find_desc=la+indita&find_loc=Tucson,+AZ
  our page: https://happyhourfriends.com/tucson/venue/la-indita-restaurant
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Los Pochos Sports Bar** (tucson) · `0470f578-fd51-4538-8ed4-8e8b71984070`
  shows now: **17:00–19:00**, every day · 1 offering(s) · content-words: 0
  deal text we store: _Happy hour pricing on drinks_
  source: https://los-pochos-sports-bar.weeblyte.com/
  our page: https://happyhourfriends.com/tucson/venue/los-pochos-sports-bar
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Pockets Pool & Pub** (tucson) · `02a49414-bccc-459c-a849-b335c0d8e24d`
  shows now: **16:00–19:00**, every day · 1 offering(s) · content-words: 0
  deal text we store: _Happy Hour Specials Drink specials offered during happy hour window_
  source: http://www.pocketstucson.com/
  our page: https://happyhourfriends.com/tucson/venue/pockets-pool-pub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Aunt Chilada's** (phoenix-central) · `9438bf27-d5c8-4582-b606-b131353bc64d`
  shows now: **11:00–18:00**, Mon–Fri · 2 offering(s) · content-words: 1
  deal text we store: _Drink specials · Appetizer specials_
  source: https://www.auntchiladas.com/menu/happy-hour
  our page: https://happyhourfriends.com/phoenix-central/venue/aunt-chilada-s
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Nu Towne Saloon** (phoenix-central) · `a72d6cb1-1066-48a1-94a3-419156df6134`
  shows now: **12:00–20:00**, Mon,Tue,Wed,Thu,Fri,Sat · 1 offering(s) · content-words: 1
  deal text we store: _Beer specials Happy hour drink specials (details not specified)_
  source: https://clubfly.com/venue/8179/nu_towne_saloon_phoenix.html
  our page: https://happyhourfriends.com/phoenix-central/venue/nu-towne-saloon
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Taco Guild** (phoenix-central) · `b64b6677-16bc-4e1a-a824-83135087b187`
  shows now: **11:00–21:00**, Tue · 1 offering(s) · content-words: 1
  deal text we store: _All Tacos_
  source: https://tacoguild.com/happy-hours-specials
  our page: https://happyhourfriends.com/phoenix-central/venue/taco-guild
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Backyards** (scottsdale) · `be20a256-c621-4fdf-aa09-35a76a280f42`
  shows now: **11:00–00:00**, Mon · 1 offering(s) · content-words: 1
  deal text we store: _Margarita_
  source: https://backyardsaz.com/specials
  our page: https://happyhourfriends.com/scottsdale/venue/backyards
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Boondocks Patio & Grill Scottsdale** (scottsdale) · `0756ff53-c1b5-4235-a0cd-04e563588946`
  shows now: **15:00–02:00**, Thu · 1 offering(s) · content-words: 1
  deal text we store: _Burgers_
  source: https://patio.boondocksaz.com/scottsdale-old-town-boondocks-old-town-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/boondocks-patio-grill-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Boondocks Patio & Grill Scottsdale** (scottsdale) · `cbba28f8-f20c-4263-9211-96226c70a4cd`
  shows now: **15:00–02:00**, Tue · 1 offering(s) · content-words: 1
  deal text we store: _Quesadillas_
  source: https://patio.boondocksaz.com/scottsdale-old-town-boondocks-old-town-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/boondocks-patio-grill-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Boondocks Patio & Grill Scottsdale** (scottsdale) · `ee22937d-45b2-4ed3-a289-5c0e96a16e45`
  shows now: **15:00–02:00**, Wed · 1 offering(s) · content-words: 1
  deal text we store: _Wings_
  source: https://patio.boondocksaz.com/scottsdale-old-town-boondocks-old-town-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/boondocks-patio-grill-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Manuel's Mexican Restaurant & Cantina | Scottsdale** (scottsdale) · `c50a98a2-7719-4e9b-91ce-5161a2f977bd`
  shows now: **ALL-DAY**, Mon · 1 offering(s) · content-words: 1
  deal text we store: _Margaritas_
  source: https://manuelsaz.com/wp-content/uploads/2025/09/DAILY-SPECIALS.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/manuel-s-mexican-restaurant-cantina-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Farrelli's Pizza** (tacoma) · `16289592-9ed7-47df-a316-109cfec42f79`
  shows now: **14:00–17:00**, every day · 1 offering(s) · content-words: 1
  deal text we store: _Happy Hour drinks and appetizers - see menu for details_
  source: https://www.yelp.com/questions/farrellis-pizza-happy-hour-what-time-does-it-star/Q5B3sPkpUS8GowtICc9R-A
  our page: https://happyhourfriends.com/tacoma/venue/farrelli-s-pizza
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Farrelli's Pizza** (tacoma) · `edaf255f-8c4e-4cfe-be55-0d015749f375`
  shows now: **21:00–close**, every day · 1 offering(s) · content-words: 1
  deal text we store: _Happy Hour drinks and appetizers - see menu for details_
  source: https://www.yelp.com/questions/farrellis-pizza-happy-hour-what-time-does-it-star/Q5B3sPkpUS8GowtICc9R-A
  our page: https://happyhourfriends.com/tacoma/venue/farrelli-s-pizza
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Fish Peddler Restaurant on Foss Waterway** (tacoma) · `39bdabae-30c5-49e4-b403-4ffe33930481`
  shows now: **14:00–17:00**, Mon–Fri · 2 offering(s) · content-words: 1
  deal text we store: _Special deals on select seafood items · Special deals on drinks during happy hour_
  source: https://www.pacificseafood.com/contact-us/retail-locations/tacoma-fish-peddler/
  our page: https://happyhourfriends.com/tacoma/venue/the-fish-peddler-restaurant-on-foss-waterway
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Wooden City Tacoma** (tacoma) · `fe295bd0-0438-4cdd-b11d-56f0722e68f3`
  shows now: **16:00–17:30**, Mon,Tue,Wed,Thu,Sun · 1 offering(s) · content-words: 1
  deal text we store: _Happy hour specials Amazing deals on drinks and appetizers during happy hour_
  source: https://cheerhop.com/tacoma/wooden-city-tacoma
  our page: https://happyhourfriends.com/tacoma/venue/wooden-city-tacoma
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Gentle Ben's** (tucson) · `074fd4ce-1a3c-4205-a7a3-049b016bb864`
  shows now: **14:00–17:00**, Mon–Fri · 1 offering(s) · content-words: 1
  deal text we store: _Happy Hour Nachos_
  source: http://gentlebens.com/menus/
  our page: https://happyhourfriends.com/tucson/venue/gentle-ben-s
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Silver Saddle Steakhouse** (tucson) · `15ae3759-3cd0-4826-a11a-a9c0aee9303d`
  shows now: **13:00–15:00**, Sun · 1 offering(s) · content-words: 1
  deal text we store: _Mimosa_
  source: https://thesilversaddlesteakhouse.com/drinks/
  our page: https://happyhourfriends.com/tucson/venue/silver-saddle-steakhouse
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Monica** (tucson) · `b37a5509-d1fb-4f8e-a4c2-dfa633322bf0`
  shows now: **14:00–18:00**, Mon–Fri · 1 offering(s) · content-words: 1
  deal text we store: _Happy hour drinks and appetizers available - specific items and prices not accessible from website_
  source: https://themonicatucson.com/
  our page: https://happyhourfriends.com/tucson/venue/the-monica
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Bad Jimmy's** (phoenix-central) · `2674fbfa-648e-424b-99c5-c66103797545`
  shows now: **21:00–close**, every day · 1 offering(s) · content-words: 2
  deal text we store: _All alcoholic beverages_
  source: https://cdn.shopify.com/s/files/1/0897/3575/8196/files/Menu49.pdf?v=1775751084
  our page: https://happyhourfriends.com/phoenix-central/venue/bad-jimmy-s
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Bad Jimmy's** (phoenix-central) · `a0b02054-906b-44bb-91b4-9ee2cba2294a`
  shows now: **15:00–18:00**, every day · 1 offering(s) · content-words: 2
  deal text we store: _All alcoholic beverages_
  source: https://cdn.shopify.com/s/files/1/0897/3575/8196/files/Menu49.pdf?v=1775751084
  our page: https://happyhourfriends.com/phoenix-central/venue/bad-jimmy-s
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Bobby-Q BBQ Restaurant and Steakhouse** (phoenix-central) · `8263e743-0d7c-46a9-8877-7444b7fab290`
  shows now: **11:00–14:00**, Sat · 2 offering(s) · content-words: 2
  deal text we store: _Small bites · Drink specials_
  source: https://bobbyqbbq.com/happy-hour
  our page: https://happyhourfriends.com/phoenix-central/venue/bobby-q-bbq-restaurant-and-steakhouse-9f0tau
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Bobby-Q BBQ Restaurant and Steakhouse** (phoenix-central) · `e74fbac4-0e77-4563-b54c-31656368d2e4`
  shows now: **11:00–14:00**, Sat · 2 offering(s) · content-words: 2
  deal text we store: _Small bites · Drink specials_
  source: https://bobbyqbbq.com/happy-hour
  our page: https://happyhourfriends.com/phoenix-central/venue/bobby-q-bbq-restaurant-and-steakhouse
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Full Moon Izakaya** (phoenix-central) · `dcc8586f-ca7f-4aed-ae8d-fc849fd19478`
  shows now: **21:00–close**, every day · 1 offering(s) · content-words: 2
  deal text we store: _Happier Hour specials Beer and drink specials_
  source: https://www.instagram.com/fullmoonphx/
  our page: https://happyhourfriends.com/phoenix-central/venue/full-moon-izakaya
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Las 15 Salsas Restaurant Oaxaqueño** (phoenix-central) · `4dea6877-0ace-4695-815b-272233ef917f`
  shows now: **12:00–18:00**, Mon–Fri · 2 offering(s) · content-words: 2
  deal text we store: _Mezcal · Cocktails_
  source: http://las15salsas.com/menu/
  our page: https://happyhourfriends.com/phoenix-central/venue/las-15-salsas-restaurant-oaxaqueno
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Playa II** (phoenix-central) · `7809e8cb-5616-4a60-a591-3356ef21aa71`
  shows now: **ALL-DAY**, Wed · 1 offering(s) · content-words: 2
  deal text we store: _All call bourbon_
  source: https://the-playa-ii.weeblyte.com/
  our page: https://happyhourfriends.com/phoenix-central/venue/the-playa-ii
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Playa II** (phoenix-central) · `b1c2cb69-9bc0-4ad4-825e-eb55603a81b6`
  shows now: **ALL-DAY**, Thu · 1 offering(s) · content-words: 2
  deal text we store: _All call tequila_
  source: https://the-playa-ii.weeblyte.com/
  our page: https://happyhourfriends.com/phoenix-central/venue/the-playa-ii
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Boondocks Patio & Grill Scottsdale** (scottsdale) · `9daa5946-6ced-45a5-a3fd-76276ddda801`
  shows now: **15:00–02:00**, Mon · 1 offering(s) · content-words: 2
  deal text we store: _Sandwiches and Wraps_
  source: https://patio.boondocksaz.com/scottsdale-old-town-boondocks-old-town-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/boondocks-patio-grill-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Parachos Tacos y Tragos** (scottsdale) · `5a3165d1-669b-4ce9-a989-f765691569c0`
  shows now: **16:00–18:00**, Fri · 1 offering(s) · content-words: 2
  deal text we store: _Frozen cocktails_
  source: https://irp.cdn-website.com/64b11b35/files/uploaded/HH_Menu.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/parachos-tacos-y-tragos
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Parachos Tacos y Tragos** (scottsdale) · `8b511bcb-84d3-451e-bf75-08f63d114ae5`
  shows now: **16:00–18:00**, Mon · 1 offering(s) · content-words: 2
  deal text we store: _Packaged beer_
  source: https://irp.cdn-website.com/64b11b35/files/uploaded/HH_Menu.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/parachos-tacos-y-tragos
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Parachos Tacos y Tragos** (scottsdale) · `f6fb8893-c937-4ab2-a09d-629507073f6e`
  shows now: **16:00–18:00**, Thu · 1 offering(s) · content-words: 2
  deal text we store: _Tequila pours_
  source: https://irp.cdn-website.com/64b11b35/files/uploaded/HH_Menu.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/parachos-tacos-y-tragos
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Fuego Nightclub** (tacoma) · `2acb17f3-e233-483a-8e05-b53ed938990b`
  shows now: **16:00–18:00**, Fri · 1 offering(s) · content-words: 2
  deal text we store: _VIP Specials VIP specials available (details not specified on website)_
  source: https://fuegoloungetacoma.com/tacoma-tacoma-fuego-nightclub-happy-hours-specials
  our page: https://happyhourfriends.com/tacoma/venue/fuego-nightclub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Dugout Sports Bar & Grill** (tucson) · `cc21c562-fdfa-4171-9f62-5e026e653eea`
  shows now: **15:00–19:00**, every day · 1 offering(s) · content-words: 2
  deal text we store: _Pitchers Great-priced pitchers_
  source: https://www.atly.com/location/The-Dugout-Sports-Bar-Grill
  our page: https://happyhourfriends.com/tucson/venue/the-dugout-sports-bar-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Vero Amore - Swan** (tucson) · `b1e49c60-6111-405d-8637-7d65676197f0`
  shows now: **16:00–18:00**, every day · 1 offering(s) · content-words: 2
  deal text we store: _Happy hour specials (4pm-6pm daily)_
  source: https://catering.veroamorepizza.com/
  our page: https://happyhourfriends.com/tucson/venue/vero-amore-swan
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________


---

## Tier B — vague filler, no concrete item or price

_20 rows. A little more text, but still no specific deal a visitor could rely on._

- [ ] **Lou's Bar & Grill At Papago Golf Course** (phoenix-central) · `fb37db48-4e89-43f4-a2cb-ce4e29f11380`
  shows now: **14:00–17:00**, Mon–Fri · 2 offering(s) · content-words: 3
  deal text we store: _Happy Hour drinks See full menu for specific items and pricing · Happy Hour appetizers See full menu for specific items and pricing_
  source: https://www.lousbarandgrill.com/happy-hour-menu/
  our page: https://happyhourfriends.com/phoenix-central/venue/lou-s-bar-grill-at-papago-golf-course
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Playa II** (phoenix-central) · `9474708d-0878-478f-b33e-1f3b9b1eed2b`
  shows now: **ALL-DAY**, Tue · 1 offering(s) · content-words: 3
  deal text we store: _All call vodka and rum_
  source: https://the-playa-ii.weeblyte.com/
  our page: https://happyhourfriends.com/phoenix-central/venue/the-playa-ii
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Valley Bar** (phoenix-central) · `cbba3a4a-ac2b-4d48-b9ff-b6e129cf91d9`
  shows now: **17:00–19:00**, Mon–Fri · 1 offering(s) · content-words: 3
  deal text we store: _Cocktails Discounted happy hour cocktails available_
  source: https://www.phoenixnewtimes.com/restaurants/valley-bar-in-downtown-phoenix-happy-hour-report-card-7612586
  our page: https://happyhourfriends.com/phoenix-central/venue/valley-bar
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dirty Dogg Saloon** (scottsdale) · `48b189c8-0fec-4b7c-a261-236120247376`
  shows now: **ALL-DAY**, Sat · 1 offering(s) · content-words: 3
  deal text we store: _Drink specials Drink specials all day during Saturday college football_
  source: http://dirtydoggsaloon.com/
  our page: https://happyhourfriends.com/scottsdale/venue/dirty-dogg-saloon
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Sushi Crush** (scottsdale) · `fae05926-e2fb-4c09-8691-c88825b86516`
  shows now: **11:00–14:00**, every day · 1 offering(s) · content-words: 3
  deal text we store: _Lunch Special Lunch special specials available - see Lunch Special menu for details_
  source: https://sushicrushaz.com/scottsdale-sushi-crush-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/sushi-crush
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Steel Creek Tacoma** (tacoma) · `2e645268-6c5c-4f09-b73d-60dede2eb389`
  shows now: **17:00–19:00**, Wed,Thu,Fri · 2 offering(s) · content-words: 3
  deal text we store: _Appetizers Happy hour appetizer specials · Well Drinks Happy hour drink specials available_
  source: https://www.steelcreekcountry.com/
  our page: https://happyhourfriends.com/tacoma/venue/steel-creek-tacoma
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Istanbul Mediterranean Cuisine & Bar** (tucson) · `631b82a1-4c94-4f25-91f6-74416ec1f796`
  shows now: **15:00–17:00**, Tue,Wed,Thu,Fri,Sat,Sun · 3 offering(s) · content-words: 3
  deal text we store: _Wine · Beer · Cocktails_
  source: https://tucsonfoodie.com/2023/12/08/istanbul-mediterranean-cuisine/
  our page: https://happyhourfriends.com/tucson/venue/istanbul-mediterranean-cuisine-bar
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Seis Kitchen** (tucson) · `db359f3c-d800-45ee-b881-8c02ac2b8780`
  shows now: **15:00–18:00**, Mon–Fri · 2 offering(s) · content-words: 3
  deal text we store: _Seis Margarita Happy hour special · Beer Happy hour special_
  source: https://tucsonfoodie.com/2025/05/13/grand-opening-seis-kitchen/
  our page: https://happyhourfriends.com/tucson/venue/seis-kitchen
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dubliner Irish Pub** (phoenix-central) · `786cd41b-5463-4e41-9ed6-0cc1bd2b1e33`
  shows now: **20:00–23:00**, Wed · 1 offering(s) · content-words: 4
  deal text we store: _Live Music Live Music (price varies)_
  source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Lovecraft** (phoenix-central) · `0048c838-59c6-4eec-8733-89e4b5d068f2`
  shows now: **15:00–18:00**, Tue,Wed,Thu,Fri · 4 offering(s) · content-words: 4
  deal text we store: _Munchies · Cocktails · Wine · Beer_
  source: https://www.lovecraftphx.com/happy-hour
  our page: https://happyhourfriends.com/phoenix-central/venue/lovecraft
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Pedal Haus Brewery** (phoenix-central) · `f5bf2522-1fdc-4487-af93-4cd748ba83f1`
  shows now: **15:00–18:00**, Mon–Fri · 3 offering(s) · content-words: 4
  deal text we store: _Cocktails · Wine · Craft beers_
  source: https://www.pedalhausbrewery.com/worlds-best-happy-hour
  our page: https://happyhourfriends.com/phoenix-central/venue/pedal-haus-brewery
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Valley Bar** (phoenix-central) · `115eab11-4f2f-46cf-a6ca-369c9053686c`
  shows now: **18:00–close**, Sun · 1 offering(s) · content-words: 4
  deal text we store: _Cocktails All night happy hour on Sundays from 6 p.m. to close_
  source: https://www.phoenixnewtimes.com/restaurants/valley-bar-in-downtown-phoenix-happy-hour-report-card-7612586
  our page: https://happyhourfriends.com/phoenix-central/venue/valley-bar
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Xolo** (phoenix-central) · `01307de4-5c89-4a77-922f-939a5961ec04`
  shows now: **15:00–18:00**, Fri,Sat · 1 offering(s) · content-words: 4
  deal text we store: _Happy Hour Specials Happy hour 3PM-6PM Friday and Saturday (specific items not detailed)_
  source: https://www.xolophx.com/weekly-specials
  our page: https://happyhourfriends.com/phoenix-central/venue/xolo
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **HiFalutin Rapid Western Grill** (tucson) · `f3e1d620-d44d-4693-8d48-4f64f5c0af3b`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Sun · 2 offering(s) · content-words: 4
  deal text we store: _Discounted appetizers Appetizer specials during happy hour · Discounted drinks Drink specials during happy hour_
  source: http://www.hifalutinaz.com/
  our page: https://happyhourfriends.com/tucson/venue/hifalutin-rapid-western-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **La Herradura Mexican Grill & Seafood** (tucson) · `791eb9aa-06f2-494b-8992-67d56e19831e`
  shows now: **17:00–22:00**, Mon,Tue,Wed,Thu · 1 offering(s) · content-words: 4
  deal text we store: _House Margarita Happy hour house margarita special_
  source: https://laherradurakitchen.com/tucson-la-herradura-mexican-grill-and-seafood-happy-hours-specials
  our page: https://happyhourfriends.com/tucson/venue/la-herradura-mexican-grill-seafood
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Seis Cantina at Joesler Village** (tucson) · `a954c81c-7929-4040-99f5-c5acc4b01bc1`
  shows now: **15:00–18:00**, Mon–Fri · 4 offering(s) · content-words: 4
  deal text we store: _Margarita · Beer selection · Sangria · Michelada_
  source: https://www.vamosatucson.com/listing/seis-kitchen-&-catering-mercado/38264/
  our page: https://happyhourfriends.com/tucson/venue/seis-cantina-at-joesler-village
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dodo Bird Kitchen and Cocktails** (scottsdale) · `4e923c68-0263-4a79-9292-0f253e578a7b`
  shows now: **15:00–close**, Sun · 1 offering(s) · content-words: 5
  deal text we store: _Reverse Happy Hour Reverse happy hour on Sunday from 3pm to close_
  source: https://www.azfamily.com/2025/09/10/50-cent-wings-other-great-deals-under-10-this-scottsdale-happy-hour/
  our page: https://happyhourfriends.com/scottsdale/venue/dodo-bird-kitchen-and-cocktails
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Capital Grille** (scottsdale) · `d7cf9275-e3ee-46ae-ac3b-ad9b786cebbb`
  shows now: **15:00–18:00**, Mon–Fri · 3 offering(s) · content-words: 5
  deal text we store: _Shareable plates · Cocktails · Wines by the glass_
  source: https://www.opentable.com/the-capital-grille-scottsdale
  our page: https://happyhourfriends.com/scottsdale/venue/the-capital-grille
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Wooden City Tacoma** (tacoma) · `734f8734-deeb-4eea-a3a0-9d0aba18bb08`
  shows now: **20:30–close**, Mon,Tue,Wed,Thu,Sun · 1 offering(s) · content-words: 5
  deal text we store: _Late night menu Late night menu available at the bar_
  source: https://cheerhop.com/tacoma/wooden-city-tacoma
  our page: https://happyhourfriends.com/tacoma/venue/wooden-city-tacoma
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Time Market** (tucson) · `e523663c-b815-4564-99e6-aa14f4a38997`
  shows now: **15:00–18:00**, every day · 2 offering(s) · content-words: 5
  deal text we store: _Draft beer pints · Wine by the glass_
  source: https://tucsonfoodie.com/2016/07/27/happy-hour-of-the-week-time-market/
  our page: https://happyhourfriends.com/tucson/venue/time-market
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________


---

## Tier C — has named items, just missing prices (likely add-prices, not stub)

_34 rows. These DO name real dishes/drinks; they only lack dollar figures. Default lean: re-extract to capture prices rather than treat as a stub._

- [ ] **Thunderbird Lounge** (phoenix-central) · `e555d644-0bad-46a9-be28-60cd037703a8`
  shows now: **16:00–18:00**, Mon–Fri · 3 offering(s) · content-words: 6
  deal text we store: _Well liquor · White Claw · Draft beer_
  source: https://thunderbirdloungephx.com/
  our page: https://happyhourfriends.com/phoenix-central/venue/thunderbird-lounge
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Backyards** (scottsdale) · `8cfd11a9-73fd-40da-893f-a6ca59828f74`
  shows now: **11:00–00:00**, Sun · 3 offering(s) · content-words: 6
  deal text we store: _Champagne Bottle · Espresso Martini · Bloody Mary_
  source: https://backyardsaz.com/specials
  our page: https://happyhourfriends.com/scottsdale/venue/backyards
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Boondocks Patio & Grill Scottsdale** (scottsdale) · `9b49918f-01db-4217-a6b5-27f05613f9b0`
  shows now: **13:00–02:00**, Fri · 1 offering(s) · content-words: 6
  deal text we store: _Fish 'n Chips & Beer Battered Fish Sandwich_
  source: https://patio.boondocksaz.com/scottsdale-old-town-boondocks-old-town-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/boondocks-patio-grill-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Night Owl Pizza & Drinks Scottsdale** (scottsdale) · `21d2d6fc-1ce2-4c6d-8250-3e8bd026dc0b`
  shows now: **15:00–18:00**, Mon–Fri · 3 offering(s) · content-words: 6
  deal text we store: _Specialty cocktails · Well liquor · Draft beer_
  source: https://www.instagram.com/nightowl.az/
  our page: https://happyhourfriends.com/scottsdale/venue/night-owl-pizza-drinks-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Moctezuma's Mexican Restaurant & Tequila Bar** (tacoma) · `0c387fb8-bcc8-4c11-ab1e-45672a05f71b`
  shows now: **21:00–close**, Mon,Tue,Wed,Thu,Sun · 2 offering(s) · content-words: 6
  deal text we store: _Happy Hour Appetizers Food and drink specials available during happy hour · House Margaritas Discount available on house margaritas_
  source: https://www.moctezumas.com/room/tacoma
  our page: https://happyhourfriends.com/tacoma/venue/moctezuma-s-mexican-restaurant-tequila-bar
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Moctezuma's Mexican Restaurant & Tequila Bar** (tacoma) · `14f9e403-f461-4c1e-89e4-5a95770d1e40`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Sun · 2 offering(s) · content-words: 6
  deal text we store: _Happy Hour Appetizers Food and drink specials available during happy hour · House Margaritas Discount available on house margaritas_
  source: https://www.moctezumas.com/room/tacoma
  our page: https://happyhourfriends.com/tacoma/venue/moctezuma-s-mexican-restaurant-tequila-bar
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dubliner Irish Pub** (phoenix-central) · `3d91ab57-6e47-45e6-bb18-27f9f294d3bd`
  shows now: **21:00–02:00**, Thu · 1 offering(s) · content-words: 8
  deal text we store: _Ladies' night - DJ at 9pm Ladies' night - DJ at 9pm (price varies)_
  source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dubliner Irish Pub** (phoenix-central) · `52c1332a-9105-43e9-b49b-1514518afb9d`
  shows now: **23:00–close**, Mon,Tue,Wed,Thu,Fri,Sat · 1 offering(s) · content-words: 8
  deal text we store: _Wells, domestics, and well wines Wells, domestics, and well wines (price varies)_
  source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Ojos Locos Sports Cantina (Metro - Phoenix, AZ)** (phoenix-central) · `aab57144-5d58-4309-80b5-c138b317dccd`
  shows now: **11:00–14:00**, Mon–Fri · 6 offering(s) · content-words: 8
  deal text we store: _Nachos · Chicken Sandwiches · Burgers · Fajitas · Wings · Street Tacos_
  source: https://ojoslocos.com/our-menu/happy-hour
  our page: https://happyhourfriends.com/phoenix-central/venue/ojos-locos-sports-cantina-metro-phoenix-az
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Saba's Mediterranean Kitchen** (phoenix-central) · `70aafd93-aa3e-4e63-aaca-f16cf67b35ca`
  shows now: **15:00–18:00**, Mon,Tue,Wed,Thu,Fri,Sat · 4 offering(s) · content-words: 8
  deal text we store: _Glasses of Wine · Craft Beer Pints · Signature Drinks · Bottles of Wine_
  source: https://sabaskitchen.com/specials
  our page: https://happyhourfriends.com/phoenix-central/venue/saba-s-mediterranean-kitchen
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Sushiholic** (phoenix-central) · `9e8e3769-4150-4dce-b91a-1aaea0ec118d`
  shows now: **20:00–close**, Mon,Tue,Wed,Thu,Fri,Sat · 2 offering(s) · content-words: 9
  deal text we store: _Sushi and appetizers · Sake and mixed drinks Reverse happy hour pricing (typically higher-end items discounted)_
  source: https://www.phoenixnewtimes.com/restaurants/sushiholic-happy-hour-report-card-9554712/
  our page: https://happyhourfriends.com/phoenix-central/venue/sushiholic
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Ojos Locos Sports Cantina (Tucson, AZ)** (tucson) · `4b3f90aa-06c5-43ad-96dc-dd34ef10fbfd`
  shows now: **11:00–14:00**, Mon–Fri · 1 offering(s) · content-words: 9
  deal text we store: _Lunch items Street Tacos, Wings, Nachos, Fajitas, Burgers, Chicken Sandwiches_
  source: https://ojoslocos.com/our-menu/happy-hour
  our page: https://happyhourfriends.com/tucson/venue/ojos-locos-sports-cantina-tucson-az
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Carlsbad Tavern** (scottsdale) · `e2fecc3f-99e6-4363-b276-dbe66c9b2b51`
  shows now: **11:00–16:00**, Tue · 1 offering(s) · content-words: 10
  deal text we store: _Red Chile Chicken Chimi topped with Jalapeno Bacon Cream Cheese Sauce_
  source: https://carlsbadtavern.com/scottsdale-south-scottsdale-carlsbad-tavern-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/carlsbad-tavern
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Ghini's French Caffe** (tucson) · `fc003b88-0ff6-436c-91f9-a9d8057eb534`
  shows now: **15:00–18:00**, Fri · 2 offering(s) · content-words: 10
  deal text we store: _Blackened Ahi Sliders · House made drink specials House made drink specials during happy hour_
  source: http://ghiniscafe.com/category/recipes/
  our page: https://happyhourfriends.com/tucson/venue/ghini-s-french-caffe
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Carlsbad Tavern** (scottsdale) · `1d2f0721-c555-4468-aa94-3972f4415ada`
  shows now: **22:00–02:00**, every day · 1 offering(s) · content-words: 11
  deal text we store: _Late Night Menu & Late Bat Specials Carl's Wings, Sliders, Carne Asada Waffle Fries and more_
  source: https://carlsbadtavern.com/scottsdale-south-scottsdale-carlsbad-tavern-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/carlsbad-tavern
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dominick's Steakhouse** (scottsdale) · `2cda2cd1-99fd-4201-be46-124d86d5eec8`
  shows now: **16:00–18:00**, every day · 2 offering(s) · content-words: 11
  deal text we store: _Small plates and appetizers Discounted small plates and appetizers · Signature cocktails Discounted cocktails during happy hour_
  source: https://www.experiencescottsdale.com/listing/dominicks-steakhouse/45191/
  our page: https://happyhourfriends.com/scottsdale/venue/dominick-s-steakhouse
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Eddie V's Prime Seafood** (scottsdale) · `cd4ff35c-d7a0-4624-8ee1-51c4e0c8b8b6`
  shows now: **16:00–close**, every day · 2 offering(s) · content-words: 11
  deal text we store: _Signature cocktails Specially priced signature cocktails · Fresh seafood appetizers Selection of fresh seafood appetizers_
  source: https://www.yelp.com/biz/eddie-vs-prime-seafood-scottsdale-7
  our page: https://happyhourfriends.com/scottsdale/venue/eddie-v-s-prime-seafood
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Parlay Kitchen + Cocktails** (scottsdale) · `5088a26c-4355-4e33-bda7-43bba0cced0d`
  shows now: **15:00–18:00**, every day · 5 offering(s) · content-words: 11
  deal text we store: _All draft beers · All starters + shareables · All signature + classic cocktails · Premium well drinks · All glasses of wine_
  source: https://theparlayaz.com/wp-content/uploads/2025/09/2025_hh_dessert.pdf
  our page: https://happyhourfriends.com/scottsdale/venue/the-parlay-kitchen-cocktails
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Monterey Court** (tucson) · `de1710ee-a423-4218-b56f-c30c95f196ff`
  shows now: **17:00–19:00**, Fri · 2 offering(s) · content-words: 11
  deal text we store: _Craft brewery tastings Featured brewery with tastings · Grilled pairings Often offered with brewery tastings_
  source: http://www.montereycourtaz.com/
  our page: https://happyhourfriends.com/tucson/venue/monterey-court
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Vicinos Local Italian** (scottsdale) · `36f16fe7-cdbc-48eb-81e1-788d67ac0295`
  shows now: **15:00–18:00**, every day · 4 offering(s) · content-words: 12
  deal text we store: _Wine discounts Wine discounts (specific items not detailed) · Beer discounts Beer discounts (specific items not detailed) · Drink discounts Drink discounts (specific items not detailed) · Select appetizers Select appetizers at special prices_
  source: https://www.vicinositalian.com/events
  our page: https://happyhourfriends.com/scottsdale/venue/vicinos-local-italian
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Bison Witches** (tucson) · `a9c5fe37-c4a0-4fb7-9d45-1664346b1e01`
  shows now: **23:00–02:00**, Mon–Fri · 1 offering(s) · content-words: 12
  deal text we store: _Select Spirits Cruzan Rum, Captain Morgan, Ballantine's Scotch, Sauza Tequila, Maker's Mark Bourbon and more_
  source: https://bisonwitchestucson.com/specials/
  our page: https://happyhourfriends.com/tucson/venue/bison-witches
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Dubliner Irish Pub** (phoenix-central) · `2352e4d8-1157-4883-ab1b-977973e0dc2b`
  shows now: **ALL-DAY**, Sat · 1 offering(s) · content-words: 14
  deal text we store: _All you can eat fish and chips (fresh cod)_
  source: https://www.happyhourmaps.com/bar_infos/729
  our page: https://happyhourfriends.com/phoenix-central/venue/dubliner-irish-pub
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **The Spot Neighborhood Grill** (scottsdale) · `540ad21b-f4d3-40ee-90b6-bd89a1bc0ab9`
  shows now: **15:00–18:00**, Mon–Fri · 2 offering(s) · content-words: 14
  deal text we store: _Crispy Green Beans, Cheese Curds, Smoked Chicken Queso and regular menu appetizers All regular menu appetizers are full-size during happy hour · Drink specials_
  source: https://thespotgrill.com/scottsdale-dc-ranch-crossings-the-spot-neighborhood-grill-happy-hours-specials
  our page: https://happyhourfriends.com/scottsdale/venue/the-spot-neighborhood-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Detroit Coney Grill** (scottsdale) · `3b06efd2-7506-48e2-bf31-392814fb8194`
  shows now: **15:00–19:00**, every day · 4 offering(s) · content-words: 15
  deal text we store: _Wings Discounted appetizer · Loaded chili cheese fries Discounted appetizer · Jack & Coke Discounted · Discounted draft beers_
  source: https://detroitconeygrill.com/faqs/
  our page: https://happyhourfriends.com/scottsdale/venue/detroit-coney-grill
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Bottled Blonde - Scottsdale** (scottsdale) · `172d50e7-133e-4593-aac5-8341dd93dc06`
  shows now: **19:00–20:00**, Fri · 4 offering(s) · content-words: 16
  deal text we store: _Signature pizzas Happy Hour specials on signature pizzas · Happy Dads Happy Hour specials on Happy Dads · Well cocktails Happy Hour specials on well cocktails · Domestic and imported bottles Happy Hour specials on domestic and imported bottles_
  source: https://bottledblondescottsdale.com/happy-hour/
  our page: https://happyhourfriends.com/scottsdale/venue/bottled-blonde-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Brother John's Beer Bourbon & BBQ** (tucson) · `87156db8-9bfb-409c-b407-ccb02e97edba`
  shows now: **11:00–22:00**, Fri · 2 offering(s) · content-words: 29
  deal text we store: _Fish & Chips Freshly beer battered Cod, BroJo's Biggie Fries, house-made Tartar Sauce, & lemon wedges · Fish Tacos Freshly beer-battered Cod, cilantro lime slaw, green chili pico, fresh limes_
  source: https://brotherjohns.com/brother-johns-beer-bourbon-bbq/menu/
  our page: https://happyhourfriends.com/tucson/venue/brother-john-s-beer-bourbon-bbq
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Picazzo's Healthy Italian Kitchen** (phoenix-central) · `ccf47440-bb33-4acc-9fd9-cc7b3c554ca4`
  shows now: **15:00–18:00**, every day · 8 offering(s) · content-words: 31
  deal text we store: _Local Drafts · House Wine By The Glass · Hot Artichoke Spinach Dip, Baked Wings, Caprese Moderna · Meat-za Balls, Herb Whipped Ricotta, Hummus · Cheesebread, Baked Brie · Zo's House-Made Sangria · Hand Crafted Cocktails · Mocktails_
  source: https://picazzos.com/specials/
  our page: https://happyhourfriends.com/phoenix-central/venue/picazzo-s-healthy-italian-kitchen
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Tutti Santi By Nina Scottsdale** (scottsdale) · `364a6d05-aae0-45d7-af04-64c2deaaa17f`
  shows now: **16:30–17:30**, Mon,Tue,Wed,Thu · 3 offering(s) · content-words: 31
  deal text we store: _Happy hour drink specials available · Most appetizers Calamari al Guazzetto, Carpaccio, Funghi Ripieni, Burrata, Broccoli Saltati, Prosciutto di Parma, Mozzarella Caprese, Calamari Fritti, Bruschetta, Zuppa di Pesce and more · Ossobuco and Branzino Veal Ossobuco (Thursdays) and Fresh Italian Branzino (Fridays)_
  source: https://www.tuttisantiristorante.com/menus/
  our page: https://happyhourfriends.com/scottsdale/venue/tutti-santi-by-nina-scottsdale
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **McMenamins Pub at Elks Temple** (tacoma) · `92c6b444-a6a1-48f4-a69e-0298115e6e38`
  shows now: **21:00–close**, Mon,Tue,Wed,Thu · 4 offering(s) · content-words: 34
  deal text we store: _McMenamins Beer pint · Well Drinks Old Crow Bourbon, Joe Penney's Gin, Spar Vodka, Spar Citrus Vodka, Lunazul Blanco Tequila, Three Rocks Silver Rum, Lauder's Scotch, High Council Brandy · Edgefield Wines glass · Edgefield Hard Cider pint_
  source: https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf
  our page: https://happyhourfriends.com/tacoma/venue/mcmenamins-pub-at-elks-temple
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Mowry and Cotton** (scottsdale) · `9fb74f79-071f-4835-8238-9f14c93a2923`
  shows now: **14:00–17:00**, Mon,Tue,Wed,Thu,Fri,Sat · 4 offering(s) · content-words: 46
  deal text we store: _Chips & Salsa Fire roasted salsa with blue corn chips · Mowry's Big Burger Aged cheddar, shallot jam, MC sauce and fixings on a brioche bun, served with Mowry fries · Turkey Cuban Swiss cheese, arugula, house pickles, sun dried tomato mustard, and aioli on pressed telera roll · Avocado Caesar Salad Gem lettuce, brioche crouton and parmesan_
  source: https://www.thephoenician.com/dine/mowry-cotton/?scid=feed67b0-9a2f-4de1-8df6-114544116108
  our page: https://happyhourfriends.com/scottsdale/venue/mowry-and-cotton
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **PROVISION** (phoenix-central) · `2f9dae9f-1ccf-4a97-8229-ac99da43a2fb`
  shows now: **15:00–18:00**, Thu,Fri · 6 offering(s) · content-words: 52
  deal text we store: _All Beers · House Wines · Selection of appetizers & small plates Whipped Feta Dip, Caprese Bruschetta, Warmed Nuts, Steak Tacos, Bacon Grilled Cheese, Charcuterie Board · Non-Alcoholic & Low ABV Options N/A Michelada, N/A Spritz, N/A Negroni, Amaro Highball · Golden Hour Iced Tea Creme de flora, black tea, lemon, simple syrup · Blackberry Lemon Drop Vodka, lemon, house-made blackberry compote, sugared rim_
  source: https://provisioncoffee.com/pages/7th-street-location
  our page: https://happyhourfriends.com/phoenix-central/venue/provision
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **PROVISION** (phoenix-central) · `50921294-79d7-4e1a-a199-47a67b051ac5`
  shows now: **15:00–17:00**, Mon,Tue,Wed · 6 offering(s) · content-words: 52
  deal text we store: _All Beers · House Wines · Selection of appetizers & small plates Whipped Feta Dip, Caprese Bruschetta, Warmed Nuts, Steak Tacos, Bacon Grilled Cheese, Charcuterie Board · Non-Alcoholic & Low ABV Options N/A Michelada, N/A Spritz, N/A Negroni, Amaro Highball · Golden Hour Iced Tea Creme de flora, black tea, lemon, simple syrup · Blackberry Lemon Drop Vodka, lemon, house-made blackberry compote, sugared rim_
  source: https://provisioncoffee.com/pages/7th-street-location
  our page: https://happyhourfriends.com/phoenix-central/venue/provision
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Ruth's Chris Steak House** (scottsdale) · `5d544586-b7e7-46c2-a80b-e33e40138635`
  shows now: **16:00–18:00**, Mon–Fri · 5 offering(s) · content-words: 61
  deal text we store: _Appetizers (Goat Cheese & Artichoke Dip, Zucchini Fries, Spicy Shrimp) Full-size appetizers · Wine (65 & Broad Chardonnay, 65 & Broad Cabernet Sauvignon) Special selection of wine · Hand-crafted cocktails (Rocks Rita, Pomegranate Martini, Ruth's Manhattan, Dirty Goose Martini, Classic Lemon Drop, Blueberry Mojito, Gamblers Old Fashioned) Special selection of hand-crafted cocktails · Entrées (Ruth's Cheeseburger, Seared Ahi Tuna, Steak Sandwich, Artisan Chicken Sandwich) Full-size mouthwatering entrées · Select Beers Special selection of select beers_
  source: https://m.ruthschris.com/happy-hour/az/scottsdale-restaurant/7307
  our page: https://happyhourfriends.com/scottsdale/venue/ruth-s-chris-steak-house
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

- [ ] **Cactus Restaurant Proctor** (tacoma) · `2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d`
  shows now: **14:00–17:00**, Mon–Fri · 6 offering(s) · content-words: 99
  deal text we store: _Loaded Nachos Monterey Jack cheese, roasted corn, black olives, jalapeños, pico de gallo, charred tomato salsa, buttermilk crema, guacamole · Green Chile Cheese Dip Green chile cheese dip, housemade chorizo, red onion, cilantro, tortilla chips · Diablo Shrimp Crispy prawns, spicy diablo sauce, coriander-pasilla slaw, mango–pineapple mojo · Bacon Guacamole Cactus guacamole with smoked bacon, poblano chiles, charred tomato salsa, topped with cotija cheese, served with warm chips and Cactus salsa · Guacamole with Green Chile Queso Traditional guacamole smothered in green-chile queso, topped with pico de gallo, served with warm chips and Cactus salsa · Classic Margarita Pueblo Viejo Blanco Tequila, organic agave nectar, fresh-squeezed lime juice_
  source: https://www.cactusrestaurants.com/menus/happy-hour
  our page: https://happyhourfriends.com/tacoma/venue/cactus-restaurant-proctor
  ► real recurring HH? ___  what's the ACTUAL deal (item + price)? ___________________
  ► DECISION: ____________   NOTES: ______________________________________________

---

## Appendix — discount-but-no-price (the literal Valentine row + 62 more)

_Excluded from the strict worksheet above because they DO carry a discount figure (`50% off`, `half price`, `$1 off`, …), so a visitor gets *something*. Still no concrete price. Listed compactly for awareness; promote any into the main review if you want them treated as stubs._


| city | venue | window | deal text we store | source |
| --- | --- | --- | --- | --- |
| phoenix-central | Arizona Wilderness DTPHX | 14:00:00–17:00:00 | $1 off pints · $3 off shareables · $2 off cocktails · $2 off wine | https://azwbeer.com/happy-hour |
| phoenix-central | Base Pizzeria | ALL-DAY | All Pizzas Half-priced pizzas | https://basepizzeria.com/ |
| phoenix-central | Geordie's at Wrigley Mansion | ALL-DAY | Lounge menu items 50% off select lounge menu items · Cocktails Discounted cocktails all day Wednesday · Wine Wine discounts all day Wednesday | https://www.postcard.inc/places/geordies-at-wrigley-mansion-phoenix-6GoQNLVOeEJ |
| phoenix-central | Geordie's at Wrigley Mansion | 15:00:00–18:00:00 | Cocktails Discounted cocktails during happy hour · Wine Wine discounts available during happy hour · Lounge menu items 50% off select lounge menu items | https://whereshouldweeat.com/ingredients/geordies-wrigley-mansion/ |
| phoenix-central | Picazzo's Healthy Italian Kitchen | ALL-DAY | Bottles of wine Half price | https://picazzos.com/specials/ |
| phoenix-central | Platform 18 at Century Grand | 16:00:00–18:00:00 | All cocktails 20% discount on all cocktails | https://www.yelp.com/biz/platform-18-at-century-grand-phoenix-3 |
| phoenix-central | Red Devil Italian Restaurant & Pizzeria | 16:00:00–19:00:00 | Beer 25% off all beer · Liquor 25% off all liquor · Wine 25% off all wine | https://www.reddevilrestaurant.com/happy-hour/ |
| phoenix-central | Red Devil Italian Restaurant & Pizzeria | 16:00:00–19:00:00 | Liquor 25% off all liquor · Wine 25% off all wine · Beer 25% off all beer | https://www.reddevilrestaurant.com/happy-hour/ |
| phoenix-central | Seamus McCaffrey's Irish Pub | ALL-DAY | Jack, Titos, Hendricks, Captain, Celaya Blanco Half Price | https://seamusmccaffreys.com/happy-hour/ |
| phoenix-central | Seamus McCaffrey's Irish Pub | ALL-DAY | Cocktails Half Price | https://seamusmccaffreys.com/happy-hour/ |
| phoenix-central | The Farish House | 16:00:00–18:00:00 | Most appetizers $2 off items like Warm Noble Baguette & Marinated Olives, The Dates, Brandied Chicken Liver Pâté, Le Pop Tart, Saucisson à l'ail crostini · Most sides $2 off items like Fingerling Potatoes, Ratatouille · Wines by the glass · Beer · Cocktails · Bottles of wine | https://farishhouse.com/menu/Farish-House-Menu.pdf |
| phoenix-central | The Parlor Pizzeria | 15:00:00–18:00:00 | $2 off pizza · $2 off glass of wine · $2 off glass of beer · $2 off appetizers | https://theparlor.us/menu/happy-hour |
| phoenix-central | Valentine | 00:00:00–17:00:00 | Natural wines 50% off | https://www.yelp.com/biz/valentine-phoenix |
| phoenix-central | Walter Studios | 16:00:00–18:00:00 | Starters and small bites $3 off starters and small bites like elote dip, fried cauliflower and nachos (regularly $10) · Draft beers $2 off drafts · Well cocktails $1 off well cocktails | https://www.phoenixmag.com/2024/11/04/happy-hour-spotlight-new-hhs-on-the-block-2/ |
| phoenix-central | Xolo | 15:00:00–18:00:00 | Draft Beer Included with BOGO Burrito offer · Burrito BOGO (Buy One Get One) | https://www.xolophx.com/weekly-specials |
| scottsdale | Backyards | 11:00:00–00:00:00 | Martinis 50% off | https://backyardsaz.com/specials |
| scottsdale | Grimaldi's Pizzeria | ALL-DAY | Wine & Sangria 50% off (reserve wines excluded) | https://www.grimaldispizzeria.com/specials/ |
| scottsdale | Heritage Kitchen + Cocktails | ALL-DAY | All wine (glasses and bottles) Half-off all glasses and bottles of wine | http://heritagescottsdale.com/ |
| scottsdale | Il Bosco - North Scottsdale | 16:00:00–17:30:00 | All drinks 25% off all drinks · Fresh house salads 25% off fresh house salads · Appetizers 25% off appetizers | https://www.ilboscopizza.com/ |
| scottsdale | Jade Palace Restaurant | 14:00:00–21:00:00 | Wine bottles 30% off wine bottle service | https://shea.jadepalace-az.com/scottsdale-jade-palace-shea-92nd-happy-hours-specials |
| scottsdale | Mamma Lucy Italian | 17:30:00–21:00:00 | All appetizers 25% off · Cocktails 25% off | http://mammalucy.com/ |
| scottsdale | Mamma Lucy Italian | 17:30:00–21:00:00 | Cacio e Pepe, Carbonara, Amatriciana, Zozzona 25% off | http://mammalucy.com/ |
| scottsdale | Mamma Lucy Italian | 17:30:00–21:00:00 | All wine bottles 25% off | http://mammalucy.com/ |
| scottsdale | Mamma Lucy Italian | 17:30:00–21:00:00 | All specials 25% off | http://mammalucy.com/ |
| scottsdale | Manuel's Mexican Restaurant & Cantina / Scottsdale | ALL-DAY | Kids meal free | https://manuelsaz.com/wp-content/uploads/2025/09/DAILY-SPECIALS.pdf |
| scottsdale | North Italia | ALL-DAY | Half Off Bottles of Wine Excludes reserve wine | https://www.northitalia.com/wp-content/uploads/2025/08/NOR_HH_SPRING-2026-NMRO_V3.pdf |
| scottsdale | Pinnacle Brewing Company | 14:00:00–21:00:00 | Crisp white wines by the glass 50% off all crisp white wines by the glass · Wings from Beerded BBQ BOGO 50% off | https://pinnaclebrewing.com/scottsdale-pinnacle-brewing-company-events |
| scottsdale | Taco Papi | ALL-DAY | Tacos 15% OFF TACOS | https://www.tacopapi.com/ |
| scottsdale | Tavern Grille Scottsdale | ALL-DAY | Pitchers of beer, bottles of wine, and specialty cocktails $2 off · Draft, bottle, and can beers $1 off · Well drinks, tavern cocktails, and glasses of wine $1 off | https://taverngrillescottsdale.com/scottsdale-tavern-grille-happy-hour-specials/ |
| scottsdale | Tavern Grille Scottsdale | 15:00:00–18:00:00 | Well drinks, tavern cocktails, and glasses of wine $1 off · Pitchers of beer, bottles of wine, and specialty cocktails $2 off · Draft, bottle, and can beers $1 off | https://taverngrillescottsdale.com/scottsdale-tavern-grille-happy-hour-specials/ |
| scottsdale | The Greene House | ALL-DAY | Bottles of Wine 1/2 off bottles of wine | https://www.thegreenehouseaz.com/?utm_source=Google&utm_medium=Organic&utm_campaign=Maps |
| scottsdale | The Parlay Kitchen + Cocktails | ALL-DAY | All bottles of wine 25% off | https://theparlayaz.com/wp-content/uploads/2025/09/2025_hh_dessert.pdf |
| scottsdale | Toca Madera Scottsdale | 16:00:00–18:00:00 | House Red · Al Pastor Tacos free range chicken, caramelized onion, cilantro, chili de arbol; 2 per order · Toca Margarita blanco tequila or 400 conejos mezcal, lime, agave, lava salt · Watermelon Margarita blanco tequila, flecha azul blanco tequila, watermelon, lime, thai basil, earl grey creme syrup · Corona · Sea Bass Tacos beer-battered, cucumber radish slaw, habanero crema; 2 per order · Tostaditas chicken tinga or short rib, black bean, radish, cilantro, fresno chile, queso fresco · Crispy Calamari jalapeño, cilantro, avocado tomatillo salsa · Queso Fundido queso chihuahua, soyrizo, mushrooms, onions, flour tortillas · Guacamole pomegranate, lime pepitas, onion, jalapeño, plantain chips · Pacifico · Modelo · House White | https://tocamadera.com/menus/scottsdale/happy-hour |
| scottsdale | Vicinos Local Italian | 15:00:00–18:00:00 | Wine bottles $60 and under Half price · Wine bottles over $60 $20 off | https://www.vicinositalian.com/reservations |
| tacoma | Duke's Seafood Tacoma | 21:00:00–close | Award Winning Clam Chowder $3 off · Most appetizers $2-$3 off appetizers and shared plates including Clam Lover's Steamer Clams, Coco Loco Prawns, Dungeness Crab items, Calamari, Lobster Risotto Bites, Salmon Sliders, and more · Most cocktails $3 off cocktails including Inhouse Infusions, Must Have Mules, Marvelous Margs, Bourbon & Brown, Classic Cocktails, Lively Libations, Can't Miss Martinis · Sparkling wines & wine by the glass $2-$3 off · Grass-fed burgers & sandwiches $5 off (North of California Burger, Duke Cheeseburger, Salmon Sandwich, Chicken Sandwich, Crab Cake Sandwich) · All Hail Caesar Salad $3 off | https://dukesseafood.com/menus/happy-hour-menu/ |
| tacoma | Duke's Seafood Tacoma | 15:00:00–18:00:00 | Sparkling wines & wine by the glass $2-$3 off · Most cocktails $3 off cocktails including Inhouse Infusions, Must Have Mules, Marvelous Margs, Bourbon & Brown, Classic Cocktails, Lively Libations, Can't Miss Martinis · All Hail Caesar Salad $3 off · Grass-fed burgers & sandwiches $5 off (North of California Burger, Duke Cheeseburger, Salmon Sandwich, Chicken Sandwich, Crab Cake Sandwich) · Award Winning Clam Chowder $3 off · Most appetizers $2-$3 off appetizers and shared plates including Clam Lover's Steamer Clams, Coco Loco Prawns, Dungeness Crab items, Calamari, Lobster Risotto Bites, Salmon Sliders, and more | https://dukesseafood.com/menus/happy-hour-menu/ |
| tacoma | Katie Downs Waterfront Tavern | 16:00:00–18:00:00 | Most appetizers Appetizers at half price | https://www.visitpiercecounty.com/listing/katie-downs-waterfront-tavern-+-eatery/60/ |
| tacoma | Katie Downs Waterfront Tavern | 21:00:00–close | Most appetizers Appetizers at half price | https://www.visitpiercecounty.com/listing/katie-downs-waterfront-tavern-+-eatery/60/ |
| tacoma | Mandolin Sushi & Japanese steak house | 11:00:00–17:00:00 | Sushi rolls All rolls 2 for $22 or 3 for $33 · Drink specials Various drink specials available | https://www.tiktok.com/discover/mandolin-restaurant-tacoma |
| tacoma | The Cloverleaf | 15:00:00–18:00:00 | Micro/Import beers $1 off micro/import beers · Wine $1 off wine · Appetizers $1 off appetizers | https://cloverleafpizza.com/promotions/ |
| tacoma | The Red Hot | ALL-DAY | Pils/Lager pours $1 off all Pils/Lager pours | http://www.redhottacoma.com/ |
| tucson | 5 Points | 15:00:00–17:00:00 | Smashed Jerusalem Artichoke (smaller version) · Bread and cheese plate with Castelvetrano olives · Wine bottles Half-priced · Wine by the glass $2 off · Staff-picked cans $1 off · Neopolitan-style pizza Exclusive to happy hour · Niçoise salad Exclusive to happy hour | https://thisistucson.com/eat/you-can-get-a-full-dinner-out-of-these-tucson-happy-hour-deals/article_f21d7db4-0573-11ee-9391-5f3c278db49b.html |
| tucson | Agustin Kitchen | 16:00:00–18:00:00 | Appetizers 20% off appetizers including Salmon Aguachile, Crab Toast, Crispy Calamari, and more · Entrees 20% off entrees including venison, salmon, chicken, steak, fish and chips, burger, and vegetarian options · Beverages 20% off all beverages | https://www.agustinkitchen.com/menu |
| tucson | AMELIAS MEXICAN KITCHEN | 14:00:00–17:00:00 | Margaritas Half-priced margaritas | https://www.yelp.com/biz/amelias-mexican-kitchen-tucson |
| tucson | AMELIAS MEXICAN KITCHEN | 14:00:00–17:00:00 | Margaritas Half-priced margaritas | https://www.yelp.com/biz/amelias-mexican-kitchen-tucson |
| tucson | AMELIAS MEXICAN KITCHEN | 14:00:00–17:00:00 | Margaritas Half-priced margaritas | https://tucsonfoodie.com/2024/03/20/amelias-mexican-kitchen/ |
| tucson | Barrio Brewing Co | 15:00:00–18:00:00 | $1 off beer $1 off all draft beer | https://barriobrewing.com/food-and-beer/ |
| tucson | Brother John's Beer Bourbon & BBQ | 11:00:00–22:00:00 | 15% off entire bill For teachers, law enforcement, firefighters, and medical professionals with work ID | https://brotherjohns.com/brother-johns-beer-bourbon-bbq/menu/ |
| tucson | Brother John's Beer Bourbon & BBQ | ALL-DAY | Whiskey & bourbon - half off Over 400 whiskey & bourbon options at 50% off with any food purchase | https://brotherjohns.com/brother-johns-beer-bourbon-bbq/menu/ |
| tucson | Cattletown Steakhouse & Saloon | 15:00:00–18:00:00 | Most appetizers Half-price appetizers | https://southernarizonaguide.com/is-cattletown-the-best-steakhouse-in-tucson/ |
| tucson | Charro Steak & Del Rey | 15:00:00–18:00:00 | Wells · House Wines · Charro Burgers · Oysters 1/2 off · Select Appetizers · Drafts | https://tacotuesday.com/restaurants/charro-steak-del-rey-downtown/ |
| tucson | Famous Sam's | 14:00:00–18:00:00 | Daily food specials (varies by day) Monday: 1/2 Price Bone-in Wings (Dine-in Only). Tuesday: Country Fried Steak. Wednesday: Pastrami Special. Thursday: 1/3lb Hamburger Special. Friday: Fish & Chips Special. Saturday: $4.00 Kids Meals All Day (11 years old and under) | https://famoussamsatriver.com/tucson-famous-sam-s-on-river-happy-hours-specials |
| tucson | Ghini's French Caffe | ALL-DAY | Wine bottles Half price wine bottles | https://www.ghiniscafe.com/beverages-menu |
| tucson | Monterey Court | 16:00:00–close | Signature cocktails Half priced | http://www.montereycourtaz.com/ |
| tucson | Monterey Court | ALL-DAY | Wine bottles Half price with entree purchase | http://www.montereycourtaz.com/ |
| tucson | P.F. Chang's | ALL-DAY | Wine bottles and champagne Half off all bottles of wine and champagne | https://locations.pfchangs.com/az/tucson/1805-e-river-rd-suite-100.html?utm_source=google_gbp&utm_medium=organic |
| tucson | Redbird Scratch Kitchen + Bar | 15:00:00–18:00:00 | Mac & Cheese pipette pasta, triple cheese sauce, Gruyère cheese, black pepper breadcrumbs. Small $7, Large $12 | https://www.redbirdrestaurants.com/menu?location=North+Oracle+Road&menu=happy-hour#1 |
| tucson | Roadies | 15:00:00–18:00:00 | Beer · Select appetizers Half off · House margaritas · Wine | https://tucsonfoodie.com/2025/04/07/roadies-now-open/ |
| tucson | Roadies | 21:00:00–close | Wine · Select appetizers Half off · House margaritas · Beer | https://tucsonfoodie.com/2025/04/07/roadies-now-open/ |
| tucson | Theresa's Mosaic | 15:00:00–17:00:00 | $20 Combos Happy hour combos | https://tacotuesday.com/restaurants/teresas-mosaic-cafe-tucson/ |
| tucson | Theresa's Mosaic | 19:00:00–close | $20 Combos Happy hour until close | https://tacotuesday.com/restaurants/teresas-mosaic-cafe-tucson/ |
| tucson | Theresa's Mosaic | ALL-DAY | $20 Combos Happy hour all day | https://tacotuesday.com/restaurants/teresas-mosaic-cafe-tucson/ |
| tucson | Union Public House | 15:00:00–18:00:00 | Poutine Fries Comfort food favorites priced $4-$12 during Social Hour · Mac & Cheese Comfort food favorites priced $4-$12 during Social Hour · Burger Comfort food favorites priced $4-$12 during Social Hour | https://www.uniontucson.com/social-hour-menu |
