# Missing happy-hour data — work inventory (4 launch areas)

_Generated 2026-05-31 from the live DB (venues with no active `happy_hours`) cross-referenced with the free harvest (`docs/hh-harvest.jsonl`). Regenerate with `scripts/harvest-hh.ts` then this query._

## Summary

| Area | Still missing | On-site signal (review) | No plain-fetch signal | No usable website |
|---|--:|--:|--:|--:|
| Phoenix (Central) | 121 | 5 | 111 | 5 |
| Scottsdale | 59 | 4 | 52 | 3 |
| Tacoma | 28 | 0 | 21 | 7 |
| Tucson | 101 | 1 | 84 | 16 |
| **Total** | **309** | **10** | **268** | **31** |

## How to attack each bucket

The buckets below are ordered by leverage. Work top-down.

### A. On-site signal found — needs review/extraction (highest value)
The harvester already found a happy-hour mention with a day or time on the venue's own
site, but it wasn't a clean enough "win" to auto-apply (missing days, wrong location,
multi-location blob, etc.). **Open the listed URL, read it, and add the window to
`docs/hh-recovered.json`** — then `npx tsx scripts/apply-harvest.ts` (dry-run) / `--apply`.
Each entry notes exactly what blocked it. Several are "time known, days unknown" — ideal
**crowdsource** prompts (pre-fill the time, ask the community for days).

### B. No plain-fetch signal — needs better tooling
Plain HTML fetch found nothing. Before calling these "no HH," rule out the two common
causes (both fixable for $0):
1. **JS-rendered menu** (Toast / Square / BentoBox / spotapps / Wix data blobs) — render
   with Playwright, then re-run the same JSON-LD + snippet extraction.
2. **PDF / image menu** — detect linked `.pdf`, parse locally (`pdf-parse`); images → OCR.
The honest split between "genuinely unpublished" and "tooling miss" here is unknown until
the harvester is instrumented to tag the failure mode (see `docs/hh-recovery-plan.md`).

### C. No usable website (social/delivery only, or none)
Facebook/Instagram/DoorDash-only or no site at all. No automated path — these are
**crowdsource / manual** targets, or a Google Business Profile / Places "popular times"
check. Lowest automated leverage.


## Phoenix (Central) — 121 missing

### A. On-site signal — review & extract (5)

| Venue | Source URL(s) | What blocked it |
|---|---|---|
| Blanco Tacos and Tequilas | http://blancotacostequila.com/ | 'weeknight happy hour' — no days/times stated |
| Kobalt | http://kobaltbarphoenix.com/ | 'Happy Hour ALL DAY' — ambiguous which days |
| Las 15 Salsas Restaurant Oaxaqueño | http://las15salsas.com/ | '12pm–6pm' — time clear, NO days stated (crowdsource: which days?) |
| Mariscos Los Arbolitos De Cajeme - Peoria | http://losarbolitosusa.com/events | banner '$5 margarita/$5 draft 3–7pm' — NO days stated (crowdsource: which days?) |
| The Porch | http://www.porchrestaurants.com/happy-hour | marketing prose, no times; copy is about the Tempe location |

### B. No plain-fetch signal — headless render / PDF / manual (111)

| Venue | Website |
|---|---|
| 36 Below | https://36belowaz.com/ |
| Abacus Inn Chinese Restaurant | https://www.theabacusinn.com/ |
| Ace of wingz | http://aceofwingz.com/ |
| Angel Thai Bistro | http://www.angelthaiaz.com/ |
| Anzio's Italian Restaurant | http://anzios.com/ |
| Arizona American Italian Club | http://azaiclub.com/ |
| Bacanora PHX | https://www.bacanoraphx.com/ |
| Barro's Pizza | https://barrospizza.com/ |
| Barro's Pizza | https://barrospizza.com/ |
| Barro's Pizza | https://barrospizza.com/ |
| Blanco Cocina + Cantina | https://www.blancotacostequila.com/locations/phoenix-az-block-23/?utm_source=Google&utm_medium=Organic&utm_campaign=Maps |
| Boycott Bar | https://www.boycottbarphx.com/ |
| Brix Kitchen+Cocktails | http://brixphoenix.com/ |
| Butler's Easy | http://www.butlerseasy.com/ |
| Cactus Tavern | http://cactustavern.com/ |
| Carolina's Mexican Food - Cactus | http://www.carolinasmexicanfood.com/ |
| Centrico | http://centricophx.com/ |
| Chase Sapphire Lounge by The Club PHX | http://chase.com/sapphireairportlounge?y_source=1_MTA4NjYwNDMwMi03MTUtbG9jYXRpb24ud2Vic2l0ZQ%3D%3D |
| China Chili | http://www.chinachilirestaurant.com/ |
| Comedor Guadalajara | https://rebrand.ly/comedor-guadalajara |
| Corazón de Agave | https://corazondeagaverestaurant.com/ |
| Cornish Pasty Co | http://www.cornishpastyco.com/ |
| Cornish Pasty Co | http://www.cornishpastyco.com/ |
| Crown Public House | http://crownpublichouse.com/ |
| Daddy-O's Grill | https://daddyosgrill.shop/ |
| Different Pointe of View | http://www.tapatiocliffshilton.com/dining/different-pointe-of-view/ |
| Doughbird | https://www.eatdoughbird.com/locations/phoenix-az/?utm_source=Google&utm_medium=Organic&utm_campaign=Maps |
| Dragon Palace | https://www.dragonpalacephoenix.com/ |
| Dwntwn | https://www.clubdwntwn.com/ |
| El Super Taco | https://elsupertacoaz.com/ |
| El Zaguan Bistro | https://www.elzaguanbistro.com/ |
| Fatso's Pizza | http://www.fatsospizza.com/ |
| Flower Child | https://www.iamaflowerchild.com/locations/phoenix-az-arcadia/?utm_source=Google&utm_medium=Organic&utm_campaign=Maps |
| Flower Child | https://www.iamaflowerchild.com/locations/flower-child-paradise-valley/ |
| Fly Bye | https://flybyetogo.com/locations/phoenix-az-arcadia/?utm_source=Google&utm_medium=Organic&utm_campaign=Maps |
| Glai Baan | https://www.glaibaanaz.com/ |
| Green New American Vegetarian | http://greenvegetarian.com/ |
| Gus's World Famous Fried Chicken | http://gusfriedchicken.com/ |
| Harumi Sushi Bar | http://harumisushiaz.com/ |
| Hillstone Restaurant | https://hillstone.com/ |
| Jewel's Bakery & Cafe | http://www.jewelsbakeryandcafe.com/ |
| Knock Kneed Lobster | http://knockkneedlobster.menutoeat.com/ |
| Krachai Thai Kitchen | http://phoenixbestthaifood.com/index.htm |
| L'amore Italian Restaurant | http://www.lamoreitalian.com/ |
| La Barquita Restaurant | https://labarquitaaz.com/ |
| Le Âme | https://www.globalambassadorhotel.com/restaurants/leame |
| Ling & Louie's Asian Bar and Grill | https://www.lingandlouies.com/ |
| Little Miss BBQ-Sunnyslope | https://www.littlemissbbq.com/ |
| Little Rituals | https://littleritualsbar.com/ |
| Lo-Lo's Chicken & Waffles | https://loloschickenandwaffles.com/location/phoenix |
| LongHorn Steakhouse | https://www.longhornsteakhouse.com/locations/az/phoenix/phoenix-metro-center/5513?cmpid=br:lh_ag:ie_ch:loc_ca:LHGMB_sn:gmb_gt:phoenix-az-5513_pl:locurl_rd:1447 |
| LongHorn Steakhouse | https://www.longhornsteakhouse.com/locations/az/phoenix/phoenix-paradise-valley/5461?cmpid=br:lh_ag:ie_ch:loc_ca:LHGMB_sn:gmb_gt:phoenix-az-5461_pl:locurl_rd:1400 |
| Los Reyes De La Torta | https://losreyesaz.com/locations/north-phoenix |
| Los Taquitos | https://lostaquitosaz.com/lostaquitos-16th-street?utm_source=google |
| Luci's at the Orchard | http://www.lucisgoodness.com/ |
| Manuel’s Mexican Restaurant & Cantina | http://www.manuelsaz.com/ |
| Mariscos Playa Hermosa | http://www.mariscosplayahermosa.com/ |
| Mensho Ramen | https://mensho.com/ |
| Metro Sportz Bar & Billiards | http://www.metrosportzbar.com/ |
| Michelina's Italian Restaurant | http://michelinasrestaurant.com/ |
| Miel De Agave Phoenix | https://lamieldeagave.com/mieldeagavephoenix?utm_source=google |
| Nami Korean Kitchen & Sushi | https://www.nami-koreankitchenaz.com/ |
| Nee House Chinese Restaurant | https://www.neehousechinese.com/ |
| North Mountain Brewing Company | http://www.northmountainbrewing.com/ |
| Ocho Rios Jerk Spot | https://ochoriosjerkspot.com/ocho-rios-jerk-spot-north-phoenix?utm_source=google_business_profile&utm_medium=local_seo&utm_campaign=organic_search |
| ollie vaughn's | https://ollievaughns.com/ |
| Original ChopShop | https://originalchopshop.com/menu/ |
| Pappadeaux Seafood Kitchen | https://pappadeaux.com/ |
| Pitic Restaurant and Lounge | http://www.piticrestaurant.com/ |
| Pizza By Napoli | https://pizzabynapoliphoenix.com/?utm_source=gbp |
| Pizzeria Bianco | http://www.pizzeriabianco.com/ |
| Pizzeria Bianco | https://www.pizzeriabianco.com/pizzeria-bianco-town-country |
| Pointe In Tyme | https://tapatiocliffshilton.com/dining/pointe-in-tyme/ |
| Presidio Cocina Mexicana | https://www.presidiophx.com/ |
| Press Coffee - The Roastery | https://presscoffee.com/pages/location-roastery |
| Richardson's Restaurant | http://richardsonsnm.com/ |
| Rosita's Place | http://rositasplace.com/ |
| Rubio's Coastal Grill | https://www.rubios.com/restaurant-locations/arizona/phoenix-bell-rd |
| Rusconi's American Kitchen | http://rusconiskitchen.com/ |
| Sala Thai North Phoenix | http://salathaiaz.com/ |
| SEOUL BBQ & SUSHI | http://seoulphx.com/ |
| Soup & Sausage Bistro | https://soupnsausagebistro.com/ |
| Stackers Restaurant | https://stackersphx.com/ |
| Steak 44 | https://www.steak44.com/?utm_source=google&utm_medium=organic&utm_campaign=gmb |
| Sushi Friend | https://yoursushifriend.com/?utm_source=google |
| Taco Boy's | https://taco-boys.shop/ |
| Taco Night & Tequila | https://taconighttequilaaz.com/ |
| Taco Viva | https://www.tacoviva.com/ |
| Tacos Calafia North | https://tacoscalafia.com/ |
| Tacos Chiwas | http://tacoschiwas.com/ |
| Tacos Veganos | http://aztacosveganos.com/ |
| Thai E-San | https://thaiesanphx.com/?utm_source=google |
| Thai Recipe Bistro | https://www.thairecipebistro.com/ |
| The Delicatessen by Chef Joey | https://thedelicatessen.com/ |
| The Duce | http://www.theducephx.com/ |
| The Liberty Tavern | http://thelibertytavernaz.com/ |
| The Little Woody | https://www.littlewoodyaz.com/ |
| The Spice Sea | https://www.thespiceseaaz.com/ |
| The Tamale Store | http://www.thetamalestore.com/ |
| théa | https://www.globalambassadorhotel.com/restaurants/thea |
| Topnotch Island Flavor Kitchen | https://topnotchislandflavorkitchen.net/?utm_source=google |
| Tortas El Rey | http://tortaselreyphoenix.com/ |
| Tutti Santi Ristorante by Nina | http://tuttisantiphoenix.com/ |
| Vayal's Indian kitchen (RESTAURANT & CATERING) | https://www.vayalskitchen.com/ |
| Vegan and Vine | http://www.veganandvineco.com/ |
| Via Della Slice Shop | http://viadellapizza.com/ |
| Via Delosantos | http://viadelosantosaz.com/ |
| Wong's Chinese Dining | http://wongs-chinesedining.com/ |
| Wren House Brewing Company | http://wrenhousebrewing.com/ |
| Ziggys Magic Pizza Shop | http://www.ziggyspizzaphx.com/ |
| Zipps Sports Grill | https://www.zippssportsgrills.com/locations/shea/ |

### C. No usable website — crowdsource / manual (5)

| Venue | Link / address |
|---|---|
| Cuban Foods Bakery & Restaurant | http://www.facebook.com/CubanFoods |
| Dora's Kitchen | 2355 S 16th St, Phoenix, AZ 85034, USA |
| Olive & Ivy | 3400 Sky Hbr Blvd, Phoenix, AZ 85034, USA |
| Sivlik Grill | 5692 W North Loop Rd, Phoenix, AZ 85048, USA |
| Taco Boy's | 9016 N Black Cyn Hwy, Phoenix, AZ 85051, USA |


## Scottsdale — 59 missing

### A. On-site signal — review & extract (4)

| Venue | Source URL(s) | What blocked it |
|---|---|---|
| Ajo Al's Mexican Cafe | https://ajoals.com/?y_source=1_MTAwMTM3MDE1Mi03MTUtbG9jYXRpb24ud2Vic2l0ZQ%3D%3D | 'daily happy hour & weekday specials' — no times |
| Chompie's Restaurant, Deli, and Bakery | https://www.chompies.com/happy-hour | JSON-LD says 'Happy Hour! GLENDALE Location Only' — not this venue |
| Dierks Bentley's Whiskey Row | https://dierkswhiskeyrow.com/menus | 'happy hour specials' mentioned, no days/times |
| Pita Jungle | https://pitajungle.com/locations/scottsdale-frank-lloyd-wright/?utm_source=google&utm_medium=organic&utm_campaign=FLW&utm_content=WebsiteLink | store-locator JSON mixes ALL locations' hours — needs headless render to isolate this one |

### B. No plain-fetch signal — headless render / PDF / manual (52)

| Venue | Website |
|---|---|
| Andreoli Italian Grocer | http://www.andreoli-grocer.com/ |
| Angry Crab Shack | https://www.angrycrabshack.com/talking-stick-way-scottsdale |
| Barro's Pizza | https://barrospizza.com/ |
| Barro's Pizza | https://barrospizza.com/ |
| Basil & Garlic | https://basilngarlicbistro.com/ |
| Boo and Henry's Memphis Pit BBQ Restaurant | https://booandhenrysbbq.com/ |
| California Pizza Kitchen at Scottsdale | https://order.cpk.com/menu/california-pizza-kitchen-scottsdale/?utm_source=GMB&utm_medium=GMB |
| Coach House | http://www.coachhousescottsdale.com/ |
| DraftKings Sportsbook at TPC Scottsdale | https://draftkingssportsbook.tpc.com/scottsdale |
| Duke's Sports Bar and Grill | https://dukessportsbar.com/ |
| el CARBÓN Mexican Eatery | https://www.elcarbonmexicaneatery.com/ |
| El Pollo Loco | https://restaurants.elpolloloco.com/az/scottsdale/15540-n-hayden-rd?utm_source=gmb&utm_medium=yext |
| Flo's | https://madebyflo.com/ |
| Flower Child | https://www.iamaflowerchild.com/locations/scottsdale-az/?utm_source=Google&utm_medium=Organic&utm_campaign=Maps |
| Fogo de Chão Brazilian Steakhouse | https://fogodechao.com/location/scottsdale/ |
| Frank & Lupe's Old Mexico | http://www.frankandlupesaz.com/ |
| George & Son's Asian Cuisine | http://georgeandsonsasiancuisine.com/ |
| Gordos Tacos | https://www.tacosgordos.com/ |
| Guido's Chicago Meats & Deli | https://www.guidosofchicago.com/ |
| Habaneros Mexican Grill & Cantina | https://habaneroscantina.com/?utm_source=google |
| Houston's | http://www.houstons.com/ |
| Karsen's Grill | https://www.karsensgrill.net/ |
| Kitchen18 | http://www.thekitchen18.com/ |
| Kodo Sushi Sake | http://www.kodosushisake.com/ |
| Koi Poke - DC Ranch | https://koipoke.com/ |
| Lo-Lo's Chicken and Waffles | https://loloschickenandwaffles.com/location/scottsdale/ |
| Luci's at the Grove | http://lucisgoodness.com/ |
| MAYA Day + Night | https://mayaclubaz.com/?utm_source=GMB&utm_medium=local |
| Nick's Italian Restaurant - FLW | http://www.nicks-italian.com/ |
| Ocean 44 | https://www.ocean44.com/ |
| Pars Persian Cuisine | http://parspersiancuisine.com/ |
| Pho Cao Restaurant and Bar | https://phocaokitchen.com/?utm_source=google |
| Pomo Pizzeria Napoletana | https://pomopizzeria.com/ |
| R.T. O'Sullivan's Sports Grill | https://scottsdale.rtosullivans.com/ |
| Randy's Restaurant & Ice Cream | http://randysrestaurantaz.com/ |
| Rudy's "Country Store" and Bar-B-Q | https://rudysbbq.com/location/detail/scottsdale-az |
| Rusty Spur Saloon | http://www.rustyspursaloon.com/ |
| Sizzle Korean Barbecue | http://www.sizzlekoreanbbq.com/ |
| sneakybird | https://sneakybird.com/menu |
| SugarJam The Southern Kitchen | https://www.sjsouthernkitchen.com/ |
| SumoMaya | https://www.sumomaya.com/ |
| Sushiholic Scottsdale | https://sushiholicscottsdale.carrd.co/ |
| The Eleanor | http://theeleanoraz.com/ |
| The Thumb | https://www.thethumb.com/ |
| Uncle Sal's | https://unclesalsaz.com/ |
| UNiQ Burger | https://www.uniqburger.com/ |
| Veneto Trattoria | http://venetotrattoria.com/ |
| Vito’s Pizza & Italian Ristorante | https://vitospizza.com/locations/scottsdale/ |
| Yen Sushi & Revolving bar | https://yensushirevolving.wehanda.com/ |
| Yo Pauly's New York Pizza Co | http://yopaulysnypc.com/ |
| Zinc Bistro | https://zincbistro.com/ |
| Zipps Sports Grill | https://www.zippssportsgrills.com/locations/frank-lloyd-wright/ |

### C. No usable website — crowdsource / manual (3)

| Venue | Link / address |
|---|---|
| Akita Sushi | 9011 E Vía Linda, Scottsdale, AZ 85258, USA |
| CM2 Pizzeria & Bakeshop | https://www.instagram.com/cm2pbs/?hl=en |
| Hiro Sushi | 9393 N 90th St, Scottsdale, AZ 85258, USA |


## Tacoma — 28 missing

### B. No plain-fetch signal — headless render / PDF / manual (21)

| Venue | Website |
|---|---|
| 7 Seas Brewery and Taproom | http://www.7seasbrewing.com/ |
| Ben Dews Clubhouse Grill | https://www.bendewsclubhousegrill.com/ |
| Cuerno Bravo Steakhouse | http://www.cuernobravo.com/ |
| Da Tiki Hut | https://www.datikihut.com/ |
| Doyle's Public House | https://www.doylespublichouse.com/ |
| E9 Firehouse & Gastropub | http://www.ehouse9.com/ |
| El Gaucho Tacoma | https://elgaucho.com/tacoma/ |
| Gyro Bites | https://www.eatgyrobites.com/ |
| Hank's Bar & Pizza | http://www.hankstacoma.com/ |
| Harbor City Tacoma Restaurant | https://harborcitytacoma.com/ |
| KIMCHI BOX | https://www.clover.com/online-ordering/kimchi-box-tacoma-2 |
| Kizuki Ramen & Izakaya (Tacoma Mall) | https://www.kizuki.com/ |
| Loak Toung Thai | http://loaktoungthai.com/ |
| Manny's Place | http://www.mannysplacetacoma.com/ |
| Peaks & Pints Tacoma Craft Beer Bar, Bottle Shop & Restaurant | http://www.peaksandpints.com/ |
| Side Piece Kitchen | http://www.sidepiecekitchen.com/home |
| Taco Street | http://www.tacostreetfood.com/ |
| The Loose Wheel Bar & Grill - Tacoma | https://www.theloosewheel.com/ |
| Tower Lanes Entertainment Center | https://www.towerlanes.net/ |
| Zen ramen & sushi burrito | https://www.cdsmnm.com/ordering/restaurant/menu?restaurant_uid=27a9f737-11ad-4d71-b75a-f8b97abc496d&client_is_mobile=true&return_url=https%3A%2F%2Fwww.zenramenbrothers.com%2F |
| Zen Ramen & Sushi Burrito - Downtown Tacoma | http://zenramenbrothers.com/ |

### C. No usable website — crowdsource / manual (7)

| Venue | Link / address |
|---|---|
| Indochine On Pearl | 4612 N Pearl St, Tacoma, WA 98407, USA |
| Parkway Tavern | 313 N I St #1, Tacoma, WA 98403, USA |
| Restaurante Los Amigos | 6402 S Tacoma Way, Tacoma, WA 98409, USA |
| Rock The Dock Pub & Grill | 535 Dock St #118, Tacoma, WA 98402, USA |
| The Church Cantina | https://m.facebook.com/The-Church-Cantina-1500987603340103/ |
| The SandBar & Grill | 1941 Marine View Dr, Tacoma, WA 98422, USA |
| The Tipsy Tomato Bar & Kitchen | 3878 Center St, Tacoma, WA 98409, USA |


## Tucson — 101 missing

### A. On-site signal — review & extract (1)

| Venue | Source URL(s) | What blocked it |
|---|---|---|
| Wild Garlic Grill | https://tucsonfoodie.com/guides/upscale-restaurants/ | only source was tucsonfoodie.com (third-party aggregator) — needs first-party page |

### B. No plain-fetch signal — headless render / PDF / manual (84)

| Venue | Website |
|---|---|
| Angry Crab Shack | https://www.angrycrabshack.com/broadway-blvd-tucson |
| Angry Crab Shack | https://www.angrycrabshack.com/grant-rd-tucson-az |
| Azian | https://www.aziansushitucson.com/ |
| Bar Crisol/Exo | http://www.barcrisol.com/ |
| Barro's Pizza | https://barrospizza.com/ |
| Bashful Bandit Barbecue | http://bashfulbanditbbq.com/ |
| Bianchi's | https://bianchisitalian.com/ |
| Big Bad Wolf Bar & Grill | http://bigbadwolftucson.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp |
| BK Carne Asada & Hot Dogs 12th Ave | http://www.bktacos.com/ |
| BK Carne Asada & Hot Dogs 1st Ave. | http://www.bktacos.com/ |
| Blue Willow Restaurant & Gift Shop | https://www.bluewillowtucson.com/ |
| BOCA by Chef Maria Mazon | http://www.bocatacos.com/ |
| Brooklyn's Beer & Burgers | https://www.brooklynsbeerandburger.com/ |
| Chariot Pizza | http://www.chariotpizza.com/ |
| Chariot Pizza | http://www.chariotpizza.com/ |
| Cheddar's Scratch Kitchen | https://www.cheddars.com/locations/az/tucson/tucson/2111?cmpid=br:csk_ag:ie_ch:loc_ca:CSKGMB_sn:gmb_gt:tucson-az-2111_pl:locurl_rd:1090 |
| Chef Alisah's Restaurant | https://www.alisahrestaurant.com/ |
| Contigo Latin Kitchen | http://www.eatatcontigo.com/ |
| Creosote-Sonoran Kitchen and Cocktails | http://theclubatstarrpass.com/dining |
| Daisy Mae's Steak House | http://www.daisymaessteakhouse.com/ |
| Delicia’s Mexican Grill | https://deliciasmexicangrilltucson.com/ |
| Diamond Cafe | http://www.ddcaz.com/tucson/dining-nightlife/diamond-cafe/ |
| Dragoon Brewing Company | http://www.dragoonbrewing.com/ |
| El Antojo Poblano | https://elantojopoblanoaz.com/ |
| El Cayo Seafood and Drinks | https://cayomtucson.com/?utm_source=google |
| El Charro Café Downtown | https://www.elcharrocafe.com/ |
| El Güero Canelo Restaurant | https://elguerocanelo.com/elgerocanelo3?utm_source=google |
| El Güero Canelo Restaurant | https://elguerocanelo.com/elgerocanelo2?utm_source=google |
| El Torero Restaurant | http://www.eltorerotucson.com/ |
| Finnegan's Pub | http://doubletree3.hilton.com/en/hotels/arizona/doubletree-suites-by-hilton-hotel-tucson-airport-TUSTADT/dining/index.html |
| Flower Child | https://www.iamaflowerchild.com/locations/flower-child-tucson/?utm_source=google&utm_medium=organic&utm_campaign=maps |
| Forbes Meat Company | https://forbesmeatcompany.com/ |
| Gourmet Girls Gluten Free Bakery/Bistro | https://www.gourmetgirlsglutenfree.com/?utm_source=google&utm_medium=organic&utm_campaign=gmb |
| Great Wall China | https://www.greatwallchinesetucson.com/ |
| Hana Tokyo | http://hanatokyoaz.com/ |
| Harbottle Brewing Company | http://www.harbottlebrewingco.com/ |
| Indian Twist | http://indiantwistaz.com/ |
| Indian Twist Airport | http://indiantwistairport.com/ |
| Jun Dynasty Chinese Restaurant | http://jundynasty.com/ |
| Karichimaka Restaurant | http://www.karichimaka.com/ |
| Kiwami Ramen | http://kiwami-ramenbar.com/ |
| Kotu Korean BBQ | https://kotukbbq.flipdish.menu/?utm_source=GBP.website&utm_medium=GBP&utm_campaign=br12301-website |
| KUKAI | http://eatkukai.com/ |
| La Chaiteria | https://www.lachaiteria.com/ |
| Le Rendez-vous | http://www.rendezvoustucson.com/ |
| Little Mexico Restaurant | http://www.littlemexico-tucson.com/ |
| Locale Neighborhood Italian Restaurant | https://www.localetucson.com/ |
| LongHorn Steakhouse | https://www.longhornsteakhouse.com/locations/az/tucson/tucson/5554?cmpid=br:lh_ag:ie_ch:loc_ca:LHGMB_sn:gmb_gt:tucson-az-5554_pl:locurl_rd:1479 |
| LongHorn Steakhouse | https://www.longhornsteakhouse.com/locations/az/tucson/tucson-broadway/5529?cmpid=br:lh_ag:ie_ch:loc_ca:LHGMB_sn:gmb_gt:tucson-az-5529_pl:locurl_rd:1462 |
| Maria Bonita Mexican Kitchen | https://mariabonitamexicankitchenaz.com/ |
| Mariscos Chihuahua on Grande | http://www.mariscoschihuahua.com/ |
| Maru Japanese Noodle Shop | https://www.marunoodle.com/ |
| Mi Nidito Restaurant | http://www.miniditorestaurant.com/ |
| Miss Saigon | http://www.misssaigontucson.com/ |
| Miss Saigon | https://www.misssaigontucson.com/ |
| New Asia Chinese Restaurant | http://www.newasiatucson.com/ |
| Opa's Best Greek American Cuisine | https://www.opasbest.com/ |
| Prep & Pastry | http://prepandpastry.com/ |
| Prep & Pastry | http://www.prepandpastry.com/ |
| Raijin Ramen | http://www.raijinramen.com/ |
| Rollies Mexican Patio | https://rolliestucson.com/patio?utm_source=google |
| Rudy's "Country Store" and Bar-B-Q | http://www.rudys.com/ |
| Sachiko Sushi | http://www.sachikorestaurant.com/ |
| Saigon Blossoms | Miss Saigon Downtown ~ Evolved | http://www.saigonblossoms.com/ |
| Salud | https://www.marriott.com/en-us/hotels/tussp-jw-marriott-tucson-starr-pass-resort-and-spa/dining/?scid=feed67b0-9a2f-4de1-8df6-114544116108 |
| Serial Grillers (Speedway Blvd.) | http://www.serialgrillersaz.com/ |
| Sher-e-Punjab | http://sherepunjabtucson.com/ |
| Signature Grill with Patio Dining | https://www.marriott.com/en-us/hotels/tussp-jw-marriott-tucson-starr-pass-resort-and-spa/dining/?scid=feed67b0-9a2f-4de1-8df6-114544116108 |
| Sushi Zona | http://www.sushizona.com/ |
| TACO GIRO - Craycroft | https://tacogiro.com/ |
| Tacos Apson | http://tacosapson.com/ |
| Taquería Juanitos | http://juanitostaqueria.com/ |
| Taquería La Esquina | https://www.taquerialaesquinatucson.com/ |
| Tavolino Ristorante Italiano | http://www.tavolinoristorante.com/ |
| Teaspoon Foothills | https://teaspoontucson.com/ |
| The Bamboo Terrace | https://thebambooterrace.com/ |
| The Grill at Hacienda del Sol | https://www.haciendadelsol.com/dining |
| Tito and Pep | https://www.titoandpep.com/ |
| Tucson Hop Shop | http://www.tucsonhopshop.com/ |
| Tuk Tuk Thai Campbell | https://tuktukcampbell.com/?utm_source=google |
| WHOLE SLVCE Pizza | https://www.wholeslvcepizza.com/ |
| Yard House | https://www.yardhouse.com/locations/az/tucson/tucson-park-place-mall/8356?cmpid=br:yh_ag:ie_ch:loc_ca:YHGMB_sn:gmb_gt:tucson-az-8356_pl:locurl_rd:1053 |
| Zayna Mediterranean Restaurant | http://www.zaynamediterranean.com/ |
| Zio Peppe | https://ziopeppeaz.com/?utm_source=google&utm_medium=organic&utm_campaign=gmb |

### C. No usable website — crowdsource / manual (16)

| Venue | Link / address |
|---|---|
| Batey Puerto Rican Gastronomy | 4230 N Oracle Rd #100, Tucson, AZ 85705, USA |
| Buggy Wheel Bar and Grill | 3156 E Drexel Rd, Tucson, AZ 85706, USA |
| Casa Valencia Mexican Seafood, Bar & Grill | 1825 W Valencia Rd, Tucson, AZ 85746, USA |
| Danny's Baboquivari Lounge | 2910 E Fort Lowell Rd, Tucson, AZ 85716, USA |
| El Charro Cafe | 7250 S Tucson Blvd Concourse B, Tucson, AZ 85756, USA |
| Hustle Bustle Cafe | 5975 W Western Way Cir SUITE 106, Tucson, AZ 85713, USA |
| KOGI Korean BBQ | 4951 E Grant Rd #115, Tucson, AZ 85712, USA |
| Lazy V | 2812 W Alvaro Rd, Tucson, AZ 85746, USA |
| M & M Saloon | 3364 E Benson Hwy #1806, Tucson, AZ 85706, USA |
| Taquería Mi Pueblo | 2264 E Benson Hwy, Tucson, AZ 85714, USA |
| The Edge - A Tucson Bar | 4635 N Flowing Wells Rd, Tucson, AZ 85705, USA |
| The Nugget | 2617 N 1st Ave #2, Tucson, AZ 85719, USA |
| The Outlaw Bar & Grill | https://www.facebook.com/theoutlawarizona/ |
| The Shelter Bar | https://facebook.com/TheShelterCocktailLounge |
| Tiny's Family Restaurant | 4900 W Ajo Hwy, Tucson, AZ 85757, USA |
| Wings y Mas | 1145 W Prince Rd, Tucson, AZ 85705, USA |
