# Meal-special review — 2026-06-12

60 live windows flagged on 51 venues across all cities. Suggested hide (evidence-backed): 23; the rest are listed on price
alone (avg > $12) and default to keep — upscale happy hours are real.

Actions: `keep` = no change; `hide` = active=false (reversible — back in the
hidden-review/re-extract pool); `delete` = permanent soft-delete, the window can
never be re-created by a future re-extraction. A hide is only ever suggested with
stated evidence; explicit happy-hour wording anywhere vetoes the suggestion.

Edit `action` fields in `docs/meal-special-review-2026-06-12.json` — or sort/filter `docs/meal-special-review-2026-06-12.csv` in a
spreadsheet and edit its action column — then: `pnpm review:meal-specials --apply <file>`
(accepts .json or .csv).

| action | evidence | avg $ | city | venue | days | time | sample |
|---|---|---|---|---|---|---|---|
| **hide** | only 1 priced item, all ≥ $30 (combo/entrée pricing) | 42.00 | Spokane | [Spencer's for Steaks & Chops](https://www.spencersspokane.com/?SEO_id=GMB-DT-R-SPCCDT&y_source=1_MTU0MDU0MDgtNzE1LWxvY2F0aW9uLndlYnNpdGU%3D) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 15:00:00–17:00:00 | $42 $42 |
| **hide** | only 1 priced item, all ≥ $30 (combo/entrée pricing) | 35.00 | Central Phoenix | [Base Pizzeria](http://www.basepizzeria.com/) | Mon | all day | Pizza $35 | Bottle of Wine |
| **hide** | meal-service language ("Lunch"); only 1 priced item, all ≥ $30 (combo/entrée pricing) | 33.00 | Scottsdale | [The Italian Daughter](http://theitaliandaughter.com/) | Mon,Tue,Wed,Thu | 14:00:00–17:30:00 | Late Lunch or Early Dinner Prix Fixe $33 |
| **hide** | only 1 priced item, all ≥ $30 (combo/entrée pricing) | 30.00 | Scottsdale | [Raven's View](http://www.ravensviewwinebar.com/) | Mon,Tue,Wed,Thu,Fri | 15:00:00–17:00:00 | $30 $30 |
| **hide** | meal-service language ("Dinner") | 25.00 | Scottsdale | [The Italiano by Chef Joey](https://www.theitaliano.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 20:00:00–close | Antipasto board & any lounge pizza $25 | House choice of red or white wine |
| **hide** | meal-service language ("Paint and Sip") | 25.00 | Scottsdale | [50 Shades of Rosé](https://50shadesofroseaz.com/) | Tue | all day | Paint and Sip $25 |
| **hide** | meal-service language ("Dinner") | 20.00 | Scottsdale | [50 Shades of Rosé](https://50shadesofroseaz.com/) | Mon | all day | Girl Dinner $20 |
| **hide** | meal-service language ("Bottomless") | 19.00 | Central Phoenix | [PV Pie & Wine](https://pvpieandwine.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | open–15:00:00 | Bottomless Bubbles $19 |
| **hide** | meal-service language ("Bottomless"); lunch-hours window with avg $19.00 | 19.00 | Central Phoenix | [PV Pie & Wine](https://pvpieandwine.com/) | Sat,Sun | 10:00:00–15:00:00 | Bottomless Bubbles $19 |
| **hide** | meal-service language ("Lunch"); lunch-hours window with avg $16.00 | 16.00 | Central Phoenix | [The Vig](https://www.thevig.us/fillmore) | Mon,Tue,Wed,Thu,Fri | 11:00:00–15:00:00 | Lunch special: soft drink + choice of entrée $16 |
| **hide** | meal-service language ("Early-Bird") | 15.95 | Five Cities (Central Coast) | [CJ's Cafe](http://www.cjscafearroyogrande.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 14:00:00–17:00:00 | Early-Bird Dinner specials $16 |
| **hide** | lunch-hours window with avg $13.63 | 13.63 | Spokane | [Izumi Sushi & Asian Bistro](http://www.izumi-spokane.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 11:00:00–15:00:00 | $20 Fried Rice $20 | $18 Combo Fried Rice $18 | $18 Combo Chow Mein $18 |
| **hide** | meal-service language ("lunch"); lunch-hours window with avg $13.49 | 13.49 | Tucson | [Golden House Chinese Fast Food](https://www.goldenhousetucson.com/) | Mon,Tue,Wed,Thu,Fri,Sat | 11:00:00–15:00:00 | Shrimp Specials $14 | Vegetarian Meat Specials $14 | Vegetarian Specials $13 |
| **hide** | meal-service language ("Lunch"); lunch-hours window with avg $12.50 | 12.50 | Tacoma | [Fondi Pizzeria Proctor](https://fondi.com/locations/fondi-pizzeria-proctor/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 11:00:00–16:00:00 | Lunch Menu Items $13 |
| **hide** | meal-service language ("Lunch") | 10.00 | Central Phoenix | [Island Grill AZ](https://islandgrillaz.com/?utm_source=google) | Mon,Tue,Wed,Thu | 11:00:00–13:00:00 | Jerk Wings $10 | Brown Stew Chicken $10 | Curry Chicken $10 |
| **hide** | meal-service language ("Bottomless") | 8.83 | Scottsdale | [Dilla Libre Dos](http://www.dillalibre.com/) | Mon,Tue,Wed,Fri,Sat,Sun | 14:00:00–17:30:00 | Carne Asada Nachos $13 | Vegan Nachos (Chickpea Chorizo or Beyond Carne Asada) $10 | Tradi |
| **hide** | meal-service language ("Bottomless") | 8.83 | Scottsdale | [Dilla Libre Dos](http://www.dillalibre.com/) | Thu | all day | Carne Asada Nachos $13 | Traditional Nachos (Carnitas or Chicken) $10 | Vegan Nachos (Chic |
| **hide** | meal-service language ("lunch") | 8.50 | Scottsdale | [Juan Jaime's](https://www.juanjaimes.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 22:00:00–01:00:00 | Two Street Dogs and Fries $9 | 3 Mini Tacos (Street Style) $9 | 2 Mini Tacos with Rice and |
| **hide** | meal-service language ("Lunch") | 8.50 | Scottsdale | [Juan Jaime's](https://www.juanjaimes.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 11:00:00–16:00:00 | 3 Mini Tacos (Street Style) $9 | 2 Mini Tacos with Rice and Beans $9 | Two Street Dogs and |
| **hide** | meal-service language ("lunch") | 7.49 | Scottsdale | [Grimaldi's Pizzeria](https://www.grimaldispizzeria.com/locations/dc-ranch/) | Mon,Tue,Wed,Thu,Fri | 11:00:00–15:00:00 | Slice, Salad, & Drink Combo $11 | Slice & Drink Combo $7 | Slice Only $4 |
| **hide** | meal-service language ("Lunch") | 5.17 | Tucson | [New York Pizza on Broadway](https://newyorkpizzaonbroadway.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 11:00:00–16:00:00 | Lunch Special 2: Two Cheese Slices + Soda $9 | Lunch Special 1: Cheese Slice + Soda $6 | A |
| **hide** | meal-service language ("Lunch") |  | Scottsdale | [Cold Beers & Cheeseburgers](https://www.coldbeers.com/cheeseburgers/) | Mon,Tue,Wed,Thu,Fri | 11:00:00–15:00:00 |  |
| **hide** | meal-service language ("Lunch") |  | Central Phoenix | [Cherryblossom Noodle cafe](https://www.cherryblossom-az.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | open–14:30:00 |  |
| keep |  | 34.00 | Tacoma | [Fondi Pizzeria Proctor](https://fondi.com/locations/fondi-pizzeria-proctor/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 14:00:00–17:00:00 | Pizza & Salad Combo $34 | Beverages |
| keep |  | 25.00 | Scottsdale | [Postino Kierland](https://www.postino.com/locations/postino-kierland) | Mon,Tue | 20:00:00–close | Board of bruschetta & bottle of wine $25 |
| keep |  | 25.00 | Tucson | [Postino Grant](https://www.postino.com/locations/postino-grant) | Mon,Tue | 20:00:00–close | Bruschetta board with wine bottle $25 |
| keep |  | 25.00 | Central Phoenix | [Postino Arcadia](https://www.postino.com/locations/postino-arcadia) | Mon,Tue | 20:00:00–close | Bruschetta board $25 | Bottle of wine with bruschetta board $25 |
| keep |  | 25.00 | Scottsdale | [Postino Highland](https://www.postino.com/locations/postino-highland) | Mon,Tue | 20:00:00–close | Bruschetta board + bottle of wine $25 |
| keep |  | 20.00 | Scottsdale | [Parachos Tacos y Tragos](https://www.tacosbyparachos.com/) | Wed | 16:00:00–18:00:00 | Angeline wine bottle $20 |
| keep |  | 19.33 | Scottsdale | [Maple & Ash](http://mapleandash.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 16:00:00–18:00:00 | Mini seafood towers $40 | Select cocktails $15 | Oysters $3 |
| keep |  | 18.00 | Tucson | [Whiskey Roads](http://www.whiskeyroadstucson.com/) | Sat | 16:00:00–19:00:00 | Whiskey Roads Ribs $18 |
| keep |  | 17.00 | Tucson | [Sullivan's Steakhouse](https://sullivanssteakhouse.com/tucson/) | Mon,Tue,Wed,Thu | 15:00:00–18:00:00 | King Crab & Goat Cheese Salad $20 | Angry Shrimp $20 | Truffle Shaved Ribeye Cheesesteak $ |
| keep |  | 15.44 | Scottsdale | [North Italia](https://www.northitalia.com/locations/scottsdale-az-kierland-commons/) | Mon,Tue,Wed,Thu,Fri | 15:00:00–18:00:00 | Bottle & Board $44 | Pizza $18 | Chef's Board $18 |
| keep |  | 15.00 | San Luis Obispo | [Quesadilla Gorilla](https://www.quesadillagorilla.com/) | Mon,Tue,Wed,Thu,Fri | 16:00:00–18:00:00 | $16 Strawberry Lemonade Mule Blanco $16 | $15 Happy Hour Monday $15 | $15 Oaxaca Old Fashi |
| keep |  | 15.00 | Scottsdale | [The Vig](https://www.thevig.us/mcdowell-mountain) | Mon | 15:00:00–close | Genuine cheeseburger + draft beer $15 |
| keep |  | 15.00 | Central Phoenix | [The Vig](https://www.thevig.us/fillmore) | Mon | 15:00:00–close | Genuine cheeseburger + draft beer $15 |
| keep |  | 15.00 | Scottsdale | [SOL Mexican Cocina](https://solcocina.com/) | Tue | 15:00:00–close | Baja Bundle $15 | SOL House Margarita | Various food and drink specials |
| keep |  | 14.99 | Tucson | [La Herradura Mexican Grill & Seafood](https://laherradurakitchen.com/) | Tue,Wed,Thu | 17:00:00–22:00:00 | Dinner Special $15 |
| keep |  | 14.99 | Tucson | [La Herradura Mexican Grill & Seafood](https://laherradurakitchen.com/) | Tue,Wed,Thu | 17:00:00–22:00:00 | Dinner Special $15 |
| keep |  | 14.99 | Tucson | [La Herradura Street Tacos & Bar](https://laherradurakitchen.com/) | Tue,Wed,Thu | 17:00:00–22:00:00 | Dinner Special $15 |
| keep |  | 14.33 | Scottsdale | [Nobu Scottsdale](https://www.noburestaurants.com/scottsdale/home/?utm_source=google&utm_medium=Yext) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 17:00:00–18:00:00 | Cold Dishes $20 | Featured Cocktail Of The Month $20 | Hot Dishes $16 |
| keep |  | 14.03 | Central Phoenix | [North Italia](https://www.northitalia.com/locations/phoenix-az-arcadia/) | Mon,Tue,Wed,Thu,Fri | 15:00:00–18:00:00 | Bottle & Board $44 | Margherita or Cacio e Pepe Pizza $18 | Chef's Board $18 |
| keep |  | 14.00 | Spokane | [The Backyard Public House](https://backyardspokane.com/) | Wed | 14:00:00–17:00:00 | $14 Wing Central $14 | Whiskey pours and cocktails |
| keep |  | 14.00 | Tucson | [Whiskey Roads](http://www.whiskeyroadstucson.com/) | Fri | 16:00:00–19:00:00 | Fish & Chips $14 |
| keep |  | 14.00 | Scottsdale | [Uncle Louie The Restaurant](https://unclelouie.com/) | Mon,Tue,Wed,Thu,Fri,Sat | 16:00:00–18:00:00 | Small Plates $15 | Bruschetta $13 | Select Cocktails |
| keep |  | 14.00 | Central Phoenix | [The Porch](http://www.porchrestaurants.com/) | Wed | all day | Bottle House Wine $20 | Short Rib Grilled Cheese and a Side $12 | Old Fashioned $10 |
| keep |  | 13.57 | Scottsdale | [Luna By Giada](https://www.lunabygiadascottsdale.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 15:00:00–17:00:00 | House Cocktails (LA STRADA, THE MODERNO, BELLA LUNA, ISABELLA, PURPLE RAIN, IL SONATA) $18 |
| keep |  | 13.50 | Tacoma | [Copper & Salt Northwest Kitchen](https://www.copperandsaltnw.com/) | Sat,Sun | 14:00:00–17:00:00 | Classic Burger $21 | Heirloom BLT $17 | Meatballs $15 |
| keep |  | 13.50 | Tacoma | [Copper & Salt Northwest Kitchen](https://www.copperandsaltnw.com/) | Mon,Tue,Wed,Thu,Fri | 15:00:00–17:00:00 | Classic Burger $21 | Heirloom BLT $17 | Meatballs $15 |
| keep |  | 12.75 | Scottsdale | [Vic & Ola's](http://vicandolas.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 15:00:00–18:00:00 | Aperitivo Cocktails $14 | Ola's Favorite Spritzes $13 | Vic's Favorite Spirits $12 |
| keep |  | 12.73 | Scottsdale | [Pitch Scottsdale - Restaurant and Pizzeria](http://pitchpizzeria.com/) | Mon,Tue,Wed,Thu,Fri | 14:00:00–18:00:00 | Weekly Feature Pizza & Bottle $40 | Featured Tequila or Bourbon Flights $15 | PITCH Platin |
| keep |  | 12.63 | Oakland | [Grand Lake Kitchen - Dimond](http://www.grandlakekitchen.com/) | Mon,Tue,Wed,Thu,Fri | 15:00:00–18:00:00 | $19 Kamala Llama hummus $19 | $18 Tuna Melt tuna salad $18 | $18 HAPPY HOUR AT GLK $18 |
| keep |  | 12.57 | Scottsdale | [Roka Akor - Scottsdale](https://rokaakor.com/scottsdale/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 16:00:00–18:00:00 | Cocktails $16 | Martinis $16 | House Sake Carafe $15 |
| keep |  | 12.43 | Tacoma | [Corbeau](https://corbeautacoma.com/) | Mon,Tue,Wed,Thu,Fri | 16:00:00–17:00:00 | Salad + Frites $18 | Burger & Frites $18 | House Old Fashioned $12 |
| keep |  | 12.42 | Central Phoenix | [Vecina](http://vecinaphx.com/) | Tue,Wed,Thu,Fri,Sat | 16:00:00–18:00:00 | Karaage $15 | White Bean Puree $15 | Featured Wine $14 |
| keep |  | 12.33 | Oakland | [Branch Line Bar](http://www.branchline.bar/) | Mon,Tue,Wed,Thu,Fri,Sat | 16:00:00–18:00:00 | Well Shot and Draft Beer $13 | House Cocktails on Menu $12 | Spinach Artichoke Dip $12 |
| keep |  | 12.29 | Scottsdale | [Benihana - Scottsdale](https://www.benihana.com/locations/scottsdale/?utm_source=google&utm_medium=organic&utm_campaign=gbp) | Mon,Tue,Wed,Thu,Fri | 15:00:00–18:00:00 | Blue Ocean Punch Bowl $35 | Tokyo wings & specialty rolls $12 | Premium cocktails $12 |
| keep |  | 12.27 | Scottsdale | [Grassroots Kitchen & Tap - Scottsdale](http://www.grassrootsaz.com/) | Mon,Tue,Wed,Thu,Fri,Sat,Sun | 15:00:00–18:00:00 | Spicy Tuna $16 | Shrimp Remoulade $15 | Hawaiian Sweet Roll Sliders $14 |
| keep |  | 12.25 | Scottsdale | [Manuel's Mexican Restaurant & Cantina | Scottsdale](https://manuelsaz.com/) | Thu | all day | Carnitas $12 |
| keep |  | 12.25 | Scottsdale | [Manuel's Mexican Restaurant & Cantina | Scottsdale](https://manuelsaz.com/) | Mon,Tue | all day | Taco, Cheese Enchilada with Rice & Beans $12 |
