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
  "wingstop", "raising canes", "panera", "qdoba", "wienerschnitzel", "church s chicken",
  "churchs texas chicken", "mod pizza", "blaze pizza", "dutch bros", "starbucks",
  // Casual-dining national chains (operator: ignore Applebee's / Red Lobster types)
  "applebees", "red lobster", "olive garden", "chilis", "tgi fridays", "fridays",
  "outback steakhouse", "texas roadhouse", "dennys", "ihop", "red robin",
  "black angus", "famous daves", "buffalo wild wings", "hooters", "round table pizza",
  "macaroni grill", "claim jumper", "ruby tuesday", "golden corral", "shari s",
  "sharis", "elmer s", "elmers", "mod sushi",
  // Arcade / entertainment / non-HH chains
  "chuck e cheese", "dave busters", "dave and busters", "round 1", "round1",
  "spare time", "bowlero", "main event", "topgolf", "gameworks",
];

/** Lowercase + drop punctuation so "Applebee's Grill + Bar" → "applebees grill bar". */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isDenylistedChain(name: string): boolean {
  const n = normalize(name);
  return CHAINS.some((c) => n === c || n.startsWith(c + " ") || n.includes(" " + c + " "));
}
