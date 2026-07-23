/**
 * Hermetic unit test for lib/places/venueName.stripPromoName (no DB / no keys). Run:
 *   pnpm test:venue-name
 */
import assert from "node:assert/strict";
import { stripPromoName } from "@/lib/places/venueName";

// STRIP — promotional parentheticals owners stuff into their Google name.
const strip: [string, string][] = [
  ["Richmond Republic Draught House (open for all world cup games)", "Richmond Republic Draught House"],
  ["The Blacktop Grill (Award-Winning Street Food)", "The Blacktop Grill"],
  ["Fortune Star | Chinese Restaurant (#1 Mandarin Style)", "Fortune Star | Chinese Restaurant"],
  ["Joe's Tavern (NOW OPEN!)", "Joe's Tavern"],
  ["Taco Spot (Voted Best Tacos)", "Taco Spot"],
];
for (const [input, want] of strip) {
  assert.equal(stripPromoName(input), want, `should strip promo: ${input}`);
}

// KEEP — legitimate qualifiers must be left untouched (stripping them merges distinct rows).
const keep = [
  "Foghorn Taproom (Divisadero)",
  "Señor Sisig (SF Mission)",
  "Cook & Craft (Shea Blvd.)",
  "Seaside Fish & Chowder (formerly Fisherman's Galley)",
  "The Good Salad (To go only)",
  "Goodfellas Pizzeria & Grill (Halal)",
  "Ojos Locos Sports Cantina (Metro - Phoenix, AZ)",
  "Blanco Cocina + Cantina", // no parens at all
];
for (const name of keep) {
  assert.equal(stripPromoName(name), name, `should keep: ${name}`);
}

// Never returns empty, even if the whole name is a promo group.
assert.equal(stripPromoName("(Grand Opening — Now Open!)"), "(Grand Opening — Now Open!)");

console.log(`✅ venue-name test passed (${strip.length} strip + ${keep.length} keep cases).`);
