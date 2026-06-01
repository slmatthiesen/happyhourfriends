/**
 * stubRank — score a stub venue by probability of having a FINDABLE happy hour,
 * using only local signals (no network, no API). Pure, no I/O.
 *
 * Combines three free signals:
 *   1. type prior   — lib/places/hhLikelihood (Google primaryType/types/name).
 *   2. harvest hit  — the last plain-fetch harvest already saw HH text on the site
 *                     yet the venue is still a stub (no days / all-day-ambiguous /
 *                     JS-skipped leftover). Strongest "go look here" evidence.
 *   3. popularity   — rating x reviews, a tiny tiebreak so well-known places that
 *                     are easy to verify float up among equal-prior venues.
 *
 * Consumed by scripts/rank-stub-candidates.ts to emit a ranked shortlist the
 * operator hand-verifies.
 */
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import type { VenueType } from "@/lib/places/venueType";

/** Boost applied when the harvest saw on-site HH text but the venue stayed a stub. */
export const HARVEST_BOOST = 0.4;
/** Max contribution of the popularity tiebreak to the score. */
export const MAX_POP_BUMP = 0.05;
/** Type-prior level below which a venue is "low-yield tail" in the report. */
export const LOW_YIELD_PRIOR = 0.35;

export interface StubScoreInput {
  name?: string | null;
  venueType?: VenueType | null;
  primaryType?: string | null;
  types?: string[] | null;
  /** harvest signal === true AND venue is still a stub. */
  harvestSignal?: boolean;
  rating?: number | null;
  userRatingCount?: number | null;
  /** Google businessStatus, e.g. OPERATIONAL | CLOSED_PERMANENTLY. */
  businessStatus?: string | null;
  hasWebsite?: boolean;
}

export interface StubScore {
  /** Final sort score, 0..1. */
  score: number;
  /** Raw type prior (null when no type signal at all). */
  base: number | null;
  /** Popularity tiebreak component already folded into `score`. */
  popBump: number;
  /** True when the venue is permanently closed → exclude from the ranked list. */
  closed: boolean;
  /** True when the venue has no website → operator must search by name. */
  noSite: boolean;
  /** Human-readable "why this rank" fragments. */
  reasons: string[];
}

/** Small, bounded popularity nudge: scaled by rating and review-count magnitude. */
function popularityBump(rating: number | null | undefined, count: number | null | undefined): number {
  const r = rating ?? 0;
  const c = count ?? 0;
  if (r <= 0 || c <= 0) return 0;
  // log10 over reviews so a 4.5★/2000-review spot beats a 4.5★/12-review one,
  // but the whole term is capped well below a single prior step.
  const magnitude = Math.min(1, Math.log10(c + 1) / 4); // ~1.0 at ~10k reviews
  return Math.min(MAX_POP_BUMP, (r / 5) * magnitude * MAX_POP_BUMP);
}

export function scoreStub(input: StubScoreInput): StubScore {
  const base = hhLikelihood({
    venueType: input.venueType ?? null,
    primaryType: input.primaryType ?? null,
    types: input.types ?? null,
    name: input.name ?? null,
  });

  const closed = (input.businessStatus ?? "").toUpperCase() === "CLOSED_PERMANENTLY";
  const noSite = input.hasWebsite === false;
  const harvestBoost = input.harvestSignal ? HARVEST_BOOST : 0;
  const popBump = popularityBump(input.rating, input.userRatingCount);

  const score = Math.min(1, (base ?? 0) + harvestBoost + popBump);

  const reasons: string[] = [];
  if (base !== null) reasons.push(`type prior ${base.toFixed(2)}`);
  else reasons.push("no type signal");
  if (input.harvestSignal) reasons.push(`+harvest HH text on site (+${HARVEST_BOOST.toFixed(2)})`);
  if (popBump > 0) reasons.push(`popularity +${popBump.toFixed(3)}`);
  if (noSite) reasons.push("no site — search by name");
  if (closed) reasons.push("CLOSED_PERMANENTLY");

  return { score, base, popBump, closed, noSite, reasons };
}
