/**
 * stubGate — the shared "is this venue a dead end?" predicate.
 *
 * A *dead-end stub* is a venue with no active happy hour that ALSO has no realistic path to
 * ever having one: it fails the alcohol gate (no alcohol → no HH possible) OR its primary
 * type is a cuisine that essentially never runs an American-style happy hour. Such venues pad
 * the public list and make the product read as empty/broken (San Jose post-mortem,
 * docs/san-jose-extraction-postmortem-2026-06-22.md).
 *
 * This is the ONE source of truth for that judgement, reused by:
 *   - scripts/suppress-dead-end-stubs.ts   (HIDE: status='no_happy_hour', reversible)
 *   - scripts/seed-enrich-candidates.ts    (set the status at stub creation)
 *   - lib/ai/extractHappyHours.ts           (its inverse, isHhLikely, gates the paid Jina tier)
 *
 * The alcohol signal lives on seed_candidates (serves_alcohol/primary_type/types), not on the
 * venue row — so callers pass an AlcoholTypeSignal derived from the candidate (joined by
 * google_place_id). A venue with NO candidate (curated/manual import) has a null signal, which
 * passes the alcohol gate and is not a zero-HH type → it is NEVER a dead end (safe default).
 */
import { hasAlcoholSignal } from "@/lib/places/chainDenylist";

/**
 * Primary types whose cross-city confirmed-HH rate is at-or-near zero — the cuisines that
 * structurally don't run happy hours. Derived 2026-06-23 from confirmed-HH-by-primary-type
 * across all live cities (San Jose post-mortem): korean 0% (0/~20), vietnamese ~4% (0/58),
 * chinese ~8.5% (1/53). thai_restaurant + indian_restaurant are already excluded pre-discovery
 * (chainDenylist EXCLUDED_PRIMARY_TYPE / seed-discover), so they don't appear here.
 *
 * Deliberately EXCLUDED despite low rates: hawaiian and taco/mexican spots — the operator
 * confirms those DO run happy hours and must never be suppressed.
 *
 * Refreshable. To re-derive:
 *   SELECT sc.primary_type,
 *          count(*) FILTER (WHERE hh.id IS NOT NULL) AS hh,
 *          count(*) AS total
 *   FROM seed_candidates sc
 *   JOIN venues v ON v.google_place_id = sc.google_place_id AND v.deleted_at IS NULL
 *   LEFT JOIN happy_hours hh ON hh.venue_id = v.id AND hh.active AND hh.deleted_at IS NULL
 *   GROUP BY 1 ORDER BY total DESC;
 */
export const ZERO_HH_TYPES: ReadonlySet<string> = new Set([
  "korean_restaurant",
  "vietnamese_restaurant",
  "chinese_restaurant",
]);

/** Discovery-captured signal for the alcohol + cuisine gate. All fields nullable — a venue
 *  imported without a Places candidate has none, and degrades to "not a dead end". */
export interface AlcoholTypeSignal {
  /** seed_candidates.serves_alcohol — Google's serves* mask. null = unknown (never gates out). */
  servesAlcohol: boolean | null;
  name: string | null;
  /** seed_candidates.primary_type. */
  primaryType: string | null;
  /** seed_candidates.types. */
  types: string[] | null;
}

/**
 * Does this candidate clear the alcohol gate? Drops ONLY when discovery explicitly captured
 * serves_alcohol=false AND there is no bar-type / alcohol-name override (hasAlcoholSignal).
 * Mirrors the gate seed-enrich-candidates.ts applies pre-enrich — this is now the shared home
 * for it (the script imports this).
 */
export function passesAlcoholGate(sig: AlcoholTypeSignal): boolean {
  if (sig.servesAlcohol === false && !hasAlcoholSignal(sig.name, sig.primaryType, sig.types)) {
    return false;
  }
  return true;
}

/**
 * The pure signal half of the dead-end test: no realistic HH path because it fails the alcohol
 * gate OR its primary type is a zero-HH cuisine. Independent of whether the venue currently has
 * an active happy hour (the caller AND-s that in).
 */
export function isDeadEndSignal(sig: AlcoholTypeSignal): boolean {
  if (!passesAlcoholGate(sig)) return true;
  if (sig.primaryType != null && ZERO_HH_TYPES.has(sig.primaryType)) return true;
  return false;
}

/**
 * The complement, used to gate the paid anti-bot (Jina) fetch tier: a venue worth spending on
 * recovery for. An alcohol-serving venue that isn't a zero-HH cuisine — bars, American,
 * gastropubs, seafood, a bot-walled `restaurant` (Rise Woodfire) all qualify.
 */
export function isHhLikely(sig: AlcoholTypeSignal): boolean {
  return !isDeadEndSignal(sig);
}

/**
 * A dead-end stub: no active happy hour AND no realistic path to one. The hide target for
 * Build A. Reversible — the persist/apply path flips status back to 'active' the moment an
 * active HH lands (Jina recovery, regate, crowdsource), so suppression never traps data.
 */
export function isDeadEndStub(input: {
  hasActiveHappyHour: boolean;
  signal: AlcoholTypeSignal;
}): boolean {
  if (input.hasActiveHappyHour) return false;
  return isDeadEndSignal(input.signal);
}
