# Tacoma stub manual check — 2026-05-29

29 venues currently exist in Tacoma as stubs (no happy_hours rows). The all-day specials extractor fix (committed `4207840`) recovered The Red Hot; this file is the operator's manual pass on the remaining stubs to see where else there's recoverable data and what the failure modes look like.

## How to use this file

For each venue: fill in the four fields. If you can't find any HH/specials info after a quick search, mark `Found: no` and move on — no obligation to be thorough.

**Found** — `yes` / `no` (did you find ANY recurring discounted offer info?)
**Where** — exact URL (or paste a short note if it's a paper menu / chalkboard / nowhere)
**Content type** — pick one: `text` (in-text HTML, extractor should handle), `image` (image-only menu / screenshot of specials, OCR needed), `pdf` (linked PDF menu, extractor handles natively), `social-embed` (Facebook/Instagram embedded post — fetch-tricky), `js-rendered` (info only appears after JS runs), `social-only` (info exists but ONLY on social, not on main site), `no-site` (operator has no web presence)
**Pattern** *(optional)* — `time-windowed` (e.g. "3-6pm Mon-Fri"), `all-day` (Red Hot pattern — day-labeled, no times), `rotating` (weekly menu changes), `seasonal`, `single-event`, or skip

Most valuable signal: **Content type** + **Where**. If most missed venues are `image` or `social-embed`, the next extractor work is OCR / social-fetch. If most are `text` and we're still missing them, that's an extractor prompt/fetch problem to dig into.

---

## Venues

### 7 Seas Brewery and Taproom
- Website: <http://www.7seasbrewing.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Ben Dews Clubhouse Grill
- Website: <https://www.bendewsclubhousegrill.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Cuerno Bravo Steakhouse
- Website: <http://www.cuernobravo.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Da Tiki Hut
- Website: <https://www.datikihut.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Doyle's Public House
- Website: <https://www.doylespublichouse.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### E9 Firehouse & Gastropub
- Website: <http://www.ehouse9.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### El Gaucho Tacoma
- Website: <https://elgaucho.com/tacoma/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: I already checked this one — couldn't find HH info. Confirm or override.

### Gyro Bites
- Website: <https://www.eatgyrobites.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Hank's Bar & Pizza
- Website: <http://www.hankstacoma.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Harbor City Tacoma Restaurant
- Website: <https://harborcitytacoma.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Indochine On Pearl
- Website: *(none on file)*
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Google Place Details returned no website. If you find one, the URL is what we'd want to backfill.

### KIMCHI BOX
- Website: <https://www.clover.com/online-ordering/kimchi-box-tacoma-2>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Stored URL is a Clover ordering link, not a venue site. Extractor likely can't get HH from that. If the venue has a real site, the URL is valuable.

### Kizuki Ramen & Izakaya (Tacoma Mall)
- Website: <https://www.kizuki.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Chain — corporate site may or may not list location-specific HH.

### Loak Toung Thai
- Website: <http://loaktoungthai.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Manny's Place
- Website: <http://www.mannysplacetacoma.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Parkway Tavern
- Website: *(none on file)*
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Google Place Details returned no website.

### Peaks & Pints Tacoma Craft Beer Bar, Bottle Shop & Restaurant
- Website: <http://www.peaksandpints.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Restaurante Los Amigos
- Website: *(none on file)*
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Google Place Details returned no website.

### Rock The Dock Pub & Grill
- Website: *(none on file)*
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Google Place Details returned no website.

### Side Piece Kitchen
- Website: <http://www.sidepiecekitchen.com/home>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### Taco Street
- Website: <http://www.tacostreetfood.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: No neighborhood assigned — may indicate weaker data overall.

### The Church Cantina
- Website: <https://m.facebook.com/The-Church-Cantina-1500987603340103/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Stored URL is Facebook-only. Extractor struggles with FB. If they have a non-FB site, that's what we'd want.

### The Loose Wheel Bar & Grill - Tacoma
- Website: <https://www.theloosewheel.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

### The SandBar & Grill
- Website: *(none on file)*
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Google Place Details returned no website.

### The Tipsy Tomato Bar & Kitchen
- Website: *(none on file)*
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Google Place Details returned no website.

### Tower Lanes Entertainment Center
- Website: <https://www.towerlanes.net/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Bowling alley — may have HH at the bar.

### Unicorn Sports Bar
- Website: <https://m.facebook.com/Unicorn-Sports-Bar-141805512526549/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Stored URL is Facebook-only.

### Zen ramen & sushi burrito
- Website: <https://www.cdsmnm.com/ordering/restaurant/menu?restaurant_uid=27a9f737-11ad-4d71-b75a-f8b97abc496d&client_is_mobile=true&return_url=https%3A%2F%2Fwww.zenramenbrothers.com%2F>
- Found:
- Where:
- Content type:
- Pattern:
- Notes: Stored URL is an ordering platform link. The `return_url=zenramenbrothers.com` hint suggests their real site is `zenramenbrothers.com` — worth verifying.

### Zen Ramen & Sushi Burrito - Downtown Tacoma
- Website: <http://zenramenbrothers.com/>
- Found:
- Where:
- Content type:
- Pattern:
- Notes:

---

## After you fill this in

Save the file. Then either: (a) paste the whole filled-in file back to me, or (b) commit it on this branch and tell me to read it. I'll work through the rows and decide:

- Which venues to re-enrich (text-readable wins likely benefit from the new extractor)
- Whether there's a pattern of failures pointing at a NEW extractor improvement (e.g. lots of OCR-needed → next fix is image/screenshot pass)
- Which stored URLs need backfilling (e.g. KIMCHI BOX's Clover link → real site)
- Which venues might just be genuinely "no online HH info" cases (those stay as crowdsource stubs and the help-wanted UX takes over)

No pressure to fill every row — `no` is a fine answer and the pattern of `no`s is itself signal.
