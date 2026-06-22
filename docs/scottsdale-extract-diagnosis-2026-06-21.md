# Scottsdale re-extract diagnosis — why each got 0 windows (2026-06-21)

Each row: the $0 enrich extract path run on one venue. 'fed' = chars of page text the model saw.

## Born & Bred, Scottsdale
- URL: https://scottsdale.bornandbredarizona.com/
- fed text length: 6601 chars | contains "happy hour": no | rawWindowCount(model proposed) = 0
- top fetched page: • https://scottsdale.bornandbredarizona.com/
- model reason: No happy hour information could be retrieved. Primary pages (happy hour, specials, drinks menu, food menu) returned 429 errors; homepage contains no happy hour schedule. Image menu shows food/drinks but lacks timing or discount indicators.

## Clancy's Jack Room
- URL: https://www.clancyspubscottsdale.com/jack-party-room
- fed text length: 11821 chars | contains "happy hour": YES → …Happy Hour Food… | rawWindowCount(model proposed) = 0
- top fetched page: • https://www.clancyspubscottsdale.com/happy-hour-menu
- model reason: No recurring happy-hour schedule found. The fetched pages show a happy-hour menu with food and drink prices, but no day-of-week or time-window information is stated.

## Clancy's Pub - Scottsdale
- URL: https://www.clancyspubscottsdale.com/
- fed text length: 14068 chars | contains "happy hour": YES → …n a new window Daily Specials · /daily-specials · Happy Hour Menu · /happy-hour-menu · Clancy's Pub in Scottsd… | rawWindowCount(model proposed) = 0
- top fetched page: • https://www.clancyspubscottsdale.com/
- model reason: Happy hour menu with food and drink pricing is available, but no day/time window is specified on the pages provided.

## Corso Italia Restaurant & Market
- URL: http://corsoitalia1.com/
- fed text length: 8337 chars | contains "happy hour": YES → …Happy Hour… | rawWindowCount(model proposed) = 0
- top fetched page: • https://corsoitalia1.com/
- model reason: Unable to retrieve happy hour information; specialized pages returned 429 errors.

## Eddie V's Prime Seafood
- URL: https://www.eddiev.com/locations/az/scottsdale/scottsdale/8510
- fed text length: 8620 chars | contains "happy hour": YES → …happy hour… | rawWindowCount(model proposed) = 0
- top fetched page: • https://www.eddiev.com/happy-hour
- model reason: No happy hour schedule found. The happy hour page and related content provided do not contain specific times, days, or pricing for recurring happy hour offerings.

## La Locanda Ristorante Italiano
- URL: https://www.lalocandaaz.com/
- fed text length: 1862 chars | contains "happy hour": YES → …Source: https://lalocandaaz.com/happyhour… | rawWindowCount(model proposed) = 0
- top fetched page: • https://lalocandaaz.com/
- model reason: Unable to extract happy-hour schedule. Most venue pages returned 429 errors; only a standard drink menu (with regular prices, no happy-hour window) was accessible.

## Modern Corner Grill
- URL: http://moderncornergrill.com/
- fed text length: 21911 chars | contains "happy hour": YES → …Source: https://moderncornergrill.com/happyhour… | rawWindowCount(model proposed) = 0
- top fetched page: • http://moderncornergrill.com/
- model reason: No happy hour schedule found. Multiple happy-hour pages returned 429 errors or did not exist; homepage and drink menu provided no happy-hour details.

## Nick's Italian Restaurant - FLW
- URL: http://www.nicks-italian.com/
- fed text length: 54580 chars | contains "happy hour": YES → …Nick&#x27;s Locations Menus Happy Hour Catering Blog Contact Us View Menu Open menu… | rawWindowCount(model proposed) = 1
- top fetched page: • http://www.nicks-italian.com/
- model reason: Nick's Italian Happy Hour at Pinnacle Peak location only: Daily 4:00-6:00 PM at the bar and patio. No itemized pricing found on the provided pages.

