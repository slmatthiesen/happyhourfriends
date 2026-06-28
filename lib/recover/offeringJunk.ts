/**
 * offeringJunk — deterministic, $0 detector for offerings that are page-scrape noise, not
 * real happy-hour deals. Born from the 2026-06-27 Bistro Amasa audit: facing a page that
 * advertised a happy-hour *time* but published no deal list, the extractor fabricated
 * offerings from the site nav bar and the regular (full-price, non-alcoholic) drink menu.
 *
 * Four high-precision rules, each returning a stable rule id so the persist gate can warn and
 * a sweep can report / soft-delete (rules 1–3 validated to ZERO false positives across all
 * 7,147 live offerings, 2026-06-27; rule 4 added 2026-06-28 from the Central Coast Brewing
 * online-shop scrape):
 *   1. nav-boilerplate — name is ≥2 words, ALL site-chrome/navigation, no food/drink word
 *      ("MENUS RESERVATIONS ABOUT CONTACT").
 *   2. bare-soft-drink — a non-food offering whose WHOLE name is a non-alcoholic soft drink
 *      with no alcohol token ("COKE", "SHRUB SODA"). Whole-name match is the guard, so
 *      "Long Island Iced Tea" / "Jack & Coke" keep their alcohol and are never flagged.
 *   3. price-as-name — name is just a "$N" price and no description carries the deal
 *      ("$4.00"); the item name was lost in the scrape.
 *   4. ecommerce-chrome — name leads with an online-store button label ("Quick View …",
 *      "Add to Cart", "Sold Out") or repeats "shop" ("Shop Beer Shop Merch"): a product
 *      grid / store nav scraped off the venue's online shop, never a happy-hour deal.
 *
 * Deliberately NOT flagged (each a real pattern seen in the data): an empty name WITH a
 * description ("$2 off beers" — the description IS the deal), pure-digit names ("805" = the
 * Firestone 805 beer), bare category headings ("Draft Beer $7"), long item-list paragraphs,
 * and NA / zero-proof named drinks (real HH deals). Pure, no I/O — goldens in
 * scripts/test-offering-junk.ts.
 */

export type OfferingJunkRule =
  | "nav-boilerplate"
  | "bare-soft-drink"
  | "price-as-name"
  | "ecommerce-chrome";

export interface OfferingJunkInput {
  name: string | null;
  priceCents: number | null;
  description: string | null;
  kind: string;
}

export interface OfferingJunkVerdict {
  rule: OfferingJunkRule;
  reason: string;
}

/** Site-chrome / navigation words. A name made up ENTIRELY of these (≥2 of them) is the
 *  nav bar mis-captured as a deal — disjoint from any food/drink term by construction. */
const NAV_WORDS = new Set([
  "menu", "menus", "reservation", "reservations", "reserve", "about", "contact", "home",
  "order", "online", "gift", "card", "cards", "location", "locations", "hour", "hours",
  "follow", "sign", "up", "newsletter", "catering", "event", "events", "private",
  "direction", "directions", "career", "careers", "shop", "book", "booking", "gallery",
  "story", "team", "press", "faq", "faqs", "blog", "login", "account", "search", "more",
  "info", "view", "our", "us", "and", "the", "find", "call", "now",
  // Online-store chrome — a name made ENTIRELY of these is a product grid / store nav
  // mis-captured as a deal ("Quick View", "Add To Cart"). The leading-label rule below
  // catches the cases where a real product name trails the button text.
  "quick", "cart", "bag", "merch", "wishlist", "checkout", "quantity", "qty", "sold",
]);

/** Whole-name soft drinks (non-alcoholic). Matched against the FULL normalized name, never
 *  by containment — "Long Island Iced Tea" contains "iced tea" but is not equal to it. */
const SOFT_DRINKS = new Set([
  "coke", "coca cola", "coca-cola", "diet coke", "pepsi", "diet pepsi", "sprite", "7up",
  "fanta", "dr pepper", "root beer", "ginger ale", "club soda", "soda", "shrub soda",
  "lemonade", "iced tea", "sweet tea", "arnold palmer", "juice", "orange juice",
  "apple juice", "cranberry juice", "water", "sparkling water", "bottled water",
  "still water", "coffee", "iced coffee", "espresso", "latte", "cappuccino", "americano",
  "hot chocolate", "milk", "milkshake", "soft drink", "fountain drink", "lemon drop", // note: see guard
]);
// "lemon drop" is BOTH a classic cocktail and (rarely) a non-alc soda — the alcohol-token
// guard below keeps the cocktail; it stays out of the set to avoid a false positive.
SOFT_DRINKS.delete("lemon drop");

/** Any of these in the name means it's an alcoholic drink — never a "bare soft drink". */
const ALCOHOL_TOKEN =
  /\b(vodka|gin|rum|tequila|whiske?y|bourbon|scotch|brandy|cognac|mezcal|wine|beer|ale|ipa|lager|stout|pilsner|porter|kolsch|cocktail|martini|margarita|mojito|daiquiri|negroni|spritz|sangria|mimosa|mule|sour|fizz|manhattan|cosmo(politan)?|seltzer|cider|prosecco|champagne|aperol|campari|sake|soju|shot|well|draft|draught|pint|jack|tito|hard|spiked|boozy)\b/i;

/** Descriptor words stripped before the whole-name soft-drink comparison. */
const DRINK_DESCRIPTORS = /\b(seasonal|small|large|each|regular|reg|house|fresh|classic)\b/gi;

/** Online-store UI label leading a scraped product-card name. A real deal never opens with
 *  "Quick View" / "Add to Cart" / "Sold Out" — even when a product name trails it (Central
 *  Coast Brewing's "Quick View Pete's Pilsner" $14.99 was a 6-pack off the online shop, not a
 *  happy-hour pour). Anchored at the start; the trailing product name is store noise too. */
const ECOMMERCE_LABEL =
  /^(quick\s*view|add\s+to\s+(cart|bag)|sold\s+out|out\s+of\s+stock|shop\s+(now|all)|buy\s+now|view\s+(product|details|cart)|select\s+options|pre[\s-]?order|notify\s+me)\b/i;

/** "Shop Beer Shop Merch" — a store-nav strip with the word "shop" repeated. A genuine
 *  offering names one deal; it never says "shop" twice. */
const REPEATED_SHOP = /\bshop\b[\s\S]*\bshop\b/i;

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function isBlank(s: string | null): boolean {
  return s == null || s.trim() === "";
}

/** Returns the matched junk rule, or null if the offering looks like a real deal. */
export function classifyOfferingJunk(o: OfferingJunkInput): OfferingJunkVerdict | null {
  const name = o.name?.trim() ?? "";

  // 3. price-as-name: the name is just a "$N" with no description to carry the deal.
  if (/^\$\s*\d+(\.\d{1,2})?$/.test(name) && isBlank(o.description)) {
    return { rule: "price-as-name", reason: `name is a bare price with no description: "${name}"` };
  }

  if (name) {
    // 4. ecommerce-chrome: an online-store product card / nav strip mis-scraped as a deal.
    //    Runs before nav-boilerplate so a name with a trailing product token ("Quick View
    //    Pete's Pilsner") is still caught — its drink word would otherwise spare it.
    if (ECOMMERCE_LABEL.test(name) || REPEATED_SHOP.test(name)) {
      return { rule: "ecommerce-chrome", reason: `online-store chrome, not a deal: "${name}"` };
    }

    // 1. nav-boilerplate: ≥2 word tokens, every one a nav/chrome word.
    const tokens = normalizeName(name).split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length >= 2 && tokens.every((t) => NAV_WORDS.has(t))) {
      return { rule: "nav-boilerplate", reason: `name is all site-navigation words: "${name}"` };
    }

    // 2. bare-soft-drink: whole name is a non-alcoholic soft drink, on a non-food offering.
    if (o.kind !== "food" && !ALCOHOL_TOKEN.test(name)) {
      const stripped = normalizeName(name).replace(DRINK_DESCRIPTORS, " ").replace(/\s+/g, " ").trim();
      if (SOFT_DRINKS.has(stripped)) {
        return { rule: "bare-soft-drink", reason: `whole name is a non-alcoholic soft drink: "${name}"` };
      }
    }
  }

  return null;
}
