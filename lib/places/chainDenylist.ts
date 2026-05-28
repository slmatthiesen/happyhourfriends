/**
 * National-chain denylist for seed discovery. These are franchises whose locations
 * either have no happy hour or aren't the local, independent spots we want to feature.
 * Filtered at discovery so they never become candidates (no Place Details / AI spend).
 *
 * This is EDITORIAL, not "all chains" — some chains have genuine happy hours we keep
 * (e.g. The Cheesecake Factory is intentionally NOT here; it's a hand-seeded venue).
 * Chains are national, so this list is reusable across cities. Easy to extend.
 *
 * Matching is on a normalized name (lowercased, punctuation stripped); a venue is
 * denied if its name starts with, or contains as a phrase, any entry below.
 */
const CHAINS: string[] = [
  // Fast food
  "mcdonalds", "burger king", "wendys", "taco bell", "kfc", "popeyes", "chick fil a",
  "chipotle", "subway", "jimmy johns", "jersey mikes", "arbys", "jack in the box",
  "carls jr", "sonic drive in", "dairy queen", "little caesars", "dominos",
  "papa johns", "pizza hut", "panda express", "five guys", "in n out", "del taco",
  "wingstop", "raising canes", "panera", "qdoba", "wienerschnitzel", "churchs chicken",
  "churchs texas chicken", "mod pizza", "blaze pizza", "dutch bros", "starbucks",
  "jollibee", "loves travel stop", "culvers", "waffle house", "first watch",
  "salad and go", "filibertos", "mesquite fresh", "petes fish chips",
  "petes fish and chips", "lolos chicken waffles", "lolos chicken and waffles",
  // Casual-dining national chains (operator: ignore Applebee's / Red Lobster types)
  "applebees", "red lobster", "olive garden", "chilis", "tgi fridays", "fridays",
  "outback steakhouse", "texas roadhouse", "dennys", "ihop", "red robin",
  "black angus", "famous daves", "buffalo wild wings", "hooters", "round table pizza",
  "macaroni grill", "claim jumper", "ruby tuesday", "golden corral", "sharis",
  "elmers", "mod sushi", "bjs restaurant", "bjs brewhouse", "the old spaghetti factory",
  "old spaghetti factory", "texas de brazil", "kura revolving sushi", "kura sushi",
  "stack 571", "peter piper pizza",
  // Operator-allowed chains (intentionally NOT here, do not add):
  //   - The Cheesecake Factory (real HH program)
  //   - Twin Peaks (operator confirmed has a great HH, 2026-05-28)
  //   - Ram Restaurant & Brewery (regional, real HH)
  //   - Ivar's Seafood Bar (regional)
  // Arcade / entertainment / non-HH chains
  "chuck e cheese", "dave busters", "dave and busters", "round 1", "round1",
  "spare time", "bowlero", "main event", "topgolf", "gameworks",
];

/**
 * Normalize for matching. CRITICAL: drop apostrophes BEFORE collapsing non-alphanum
 * to spaces. Otherwise "Applebee's Grill" → "applebee s grill" (with a space where
 * the apostrophe was), and the denylist entry "applebees" never matches — which is
 * exactly the bug that let Applebee's / Wendy's / Denny's / BJ's all slip through
 * the discovery + enrich chain gates in the 2026-05-27 Tacoma run.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    // Strip apostrophes (straight U+0027, right curly U+2019, left curly U+2018).
    // MUST be done BEFORE the alphanum-to-space pass — otherwise "Culver's" with a
    // curly apostrophe becomes "culver s" (with a space), losing the match against
    // the denylist entry "culvers". Editors silently convert literal curly quotes
    // to straight on save, so we use \u escapes to lock the regex.
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isDenylistedChain(name: string): boolean {
  const n = normalize(name);
  return CHAINS.some((c) => n === c || n.startsWith(c + " ") || n.includes(" " + c + " "));
}

/**
 * Name-pattern denylist for venue formats that, by definition, don't run a happy
 * hour. These slip past the alcohol gate (a buffet can serve alcohol) and the chain
 * gate (most are independent), so they need their own filter.
 *
 * Expanded 2026-05-28 after a Phoenix discovery returned 212 candidates with ~150
 * non-HH formats — food trucks, carnicerias, breakfast/brunch spots, museums, etc.
 * The Phoenix list was the basis for everything below. Operator explicitly DID NOT
 * want "lounge" filtered (real lounges = good HH spots).
 *
 * Operator-allowed (intentionally NOT here):
 *   - lounge (operator: lounges are good)
 *   - sushi-only / ramen-only / pho-only / Thai / vegetarian (too aggressive — many
 *     do run HH; AI stub outcome handles those that don't)
 */
const NO_HH_FORMAT_PATTERNS = [
  // All-you-can-eat formats — by definition already discounted
  "buffet",
  "ayce",
  "all you can eat",
  // Mobile / non-sit-down formats
  "food truck",
  "trailer", // food trailer
  // Latin specialty formats (Phoenix-discovery pattern — these are takeout-focused)
  "carniceria",
  "panaderia",
  "pozoleria",
  "menuderia",
  "taqueria", // standalone "Taqueria X" is usually quick-serve; sit-downs use "Bar"/"Cantina"
  "birrieria",
  // Breakfast / brunch / diner formats — HH is post-work, not these
  "breakfast",
  "brunch",
  "diner",
  "waffle", // Waffle Stop, etc.
  // Niche food formats
  "acai", // acai bowl shops
  // Non-restaurant venues that Google occasionally types as "restaurant"
  "bookstore",
  "museum",
  "theatre",
  "theater",
  // Adult entertainment — even when they have HH, operator doesn't want them featured
  "cabaret",
  "gentlemens club",
  "topless",
];

export function isLikelyNoHappyHourFormat(name: string): boolean {
  const n = normalize(name);
  // Word-boundary match — substring would let "deli" match "delicias", "acai" match
  // "açaí" variations, etc. (2026-05-28: dropped "Las Delicias Restaurant" by mistake).
  return NO_HH_FORMAT_PATTERNS.some(
    (p) =>
      n === p ||
      n.startsWith(p + " ") ||
      n.endsWith(" " + p) ||
      n.includes(" " + p + " "),
  );
}
