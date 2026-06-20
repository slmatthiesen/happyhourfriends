/**
 * Dedup planners for the `new_happy_hour` apply path (lib/apply/engine.ts).
 *
 * happy_hours carries a natural unique key (venue_id, days_of_week, start_time, end_time,
 * location_within_venue) that includes soft-deleted rows, so a submission proposing a
 * window that already exists would crash a blind INSERT on happy_hours_natural_uq. These
 * pure functions decide the write up front — insert a fresh window, resurrect a soft-deleted
 * one, or attach to a live one — and which of the ride-along offerings are genuinely new.
 * Pure (no DB) so the decision is unit-tested without a live Postgres.
 */

export interface ExistingWindow {
  id: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  locationWithinVenue: string | null;
  deletedAt: Date | null;
}

export interface ProposedWindow {
  daysOfWeek: number[];
  startTime: string | null;
  endTime?: string | null;
  locationWithinVenue?: string | null;
}

export type HappyHourPlan =
  | { mode: "insert" }
  | { mode: "attach"; happyHourId: string; resurrect: boolean };

/** location_within_venue defaults to "all" (matches the DB column default). */
const DEFAULT_LOCATION = "all";

function sortedDays(days: number[]): number[] {
  return [...new Set(days.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort(
    (a, b) => a - b,
  );
}

/** Normalise a time to HH:MM so "15:00" and "15:00:00" compare equal; null = until close. */
function normaliseTime(t: string | null | undefined): string | null {
  if (t == null || t === "") return null;
  return t.slice(0, 5);
}

function naturalKey(w: {
  daysOfWeek: number[];
  startTime: string | null;
  endTime?: string | null;
  locationWithinVenue?: string | null;
}): string {
  return JSON.stringify([
    sortedDays(w.daysOfWeek),
    normaliseTime(w.startTime),
    normaliseTime(w.endTime),
    w.locationWithinVenue || DEFAULT_LOCATION,
  ]);
}

/**
 * Decide how to write a proposed happy-hour window given the venue's existing rows
 * (live AND soft-deleted — the natural key spans both). At most one row can share a
 * key, so the first match wins.
 */
export function planNewHappyHour(
  proposed: ProposedWindow,
  existing: ExistingWindow[],
): HappyHourPlan {
  const key = naturalKey(proposed);
  const match = existing.find((w) => naturalKey(w) === key);
  if (!match) return { mode: "insert" };
  return { mode: "attach", happyHourId: match.id, resurrect: match.deletedAt != null };
}

export interface OfferingLike {
  kind?: unknown;
  category?: unknown;
  name?: unknown;
  priceCents?: unknown;
  [k: string]: unknown;
}

function offeringKey(o: OfferingLike): string {
  const name = typeof o.name === "string" ? o.name.toLowerCase().trim() : "";
  const price = o.priceCents == null ? "" : String(o.priceCents);
  return JSON.stringify([o.kind ?? "", o.category ?? "", name, price]);
}

/**
 * Filter ride-along offerings down to the ones not already present on the target window,
 * also de-duplicating the proposed list against itself. Lets the attach/resurrect paths
 * add genuinely new offerings without re-inserting duplicates.
 */
export function newOfferingsToInsert<T extends OfferingLike>(
  proposed: T[],
  existing: OfferingLike[],
): T[] {
  const seen = new Set(existing.map(offeringKey));
  const out: T[] = [];
  for (const o of proposed) {
    const k = offeringKey(o);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}
