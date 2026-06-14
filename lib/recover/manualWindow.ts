/**
 * Operator manual happy-hour entry (Component C) — the narrow exception to "no manual venue
 * patching": used ONLY for venues whose site is confirmed unreadable (hh_probe_status='blocked'
 * and re-extract produced nothing), so the extractor cannot do the job. The operator entering
 * the data IS the verification, so the window lands active=true and the venue goes complete —
 * it bypasses the realness gate (which exists to catch UNVERIFIED extractor output).
 *
 * buildManualWindowInsert is pure (validation + row shaping) and unit-tested. createManualWindow
 * is the thin DB writer (audit + venue promotion) used by the admin server action.
 */
import { and, eq, sql } from "drizzle-orm";
import type { db as DbInstance } from "@/db/client";
import { venues, cities, happyHours, offerings, auditLog } from "@/db/schema";

export interface ManualOffering {
  kind: "food" | "drink" | "other";
  category: "beer" | "wine" | "cocktail" | "spirit" | "appetizer" | "entree" | "dessert" | "other";
  name: string;
  priceCents?: number | null;
}

export interface ManualWindowInput {
  venueId: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  sourceUrl: string;
  offerings: ManualOffering[];
}

export interface ManualWindowRows {
  hhRow: {
    venueId: string;
    daysOfWeek: number[];
    startTime: string | null;
    endTime: string | null;
    allDay: boolean;
    timeKnown: boolean;
    active: boolean;
    sourceUrl: string;
    notes: string;
  };
  offeringRows: Array<{
    kind: ManualOffering["kind"];
    category: ManualOffering["category"];
    name: string;
    priceCents: number | null;
    sourceUrl: string;
    active: boolean;
  }>;
}

/** Pure: validate operator input and shape the happy_hours + offerings rows. Throws on
 *  invalid input (a bad form must fail loud, never silently write a malformed window). */
export function buildManualWindowInsert(input: ManualWindowInput): ManualWindowRows {
  if (!input.venueId) throw new Error("manual window needs a venueId");
  const days = [...new Set(input.daysOfWeek)].sort((a, b) => a - b);
  if (days.length === 0) throw new Error("manual window needs at least one day");
  if (!days.every((d) => d >= 1 && d <= 7)) throw new Error("days must be ISO 1..7");
  if (!input.startTime && !input.endTime)
    throw new Error("manual window needs at least one time bound (start or end)");
  if (!input.sourceUrl || !input.sourceUrl.trim())
    throw new Error("manual window needs a first-party source url");

  return {
    hhRow: {
      venueId: input.venueId,
      daysOfWeek: days,
      startTime: input.startTime,
      endTime: input.endTime,
      allDay: false,
      timeKnown: true, // operator entered a real time bound
      active: true, // operator trust → live (bypasses the realness gate)
      sourceUrl: input.sourceUrl.trim(),
      notes: "operator manual entry (unreadable site)",
    },
    offeringRows: input.offerings
      .filter((o) => o.name?.trim())
      .map((o) => ({
        kind: o.kind,
        category: o.category,
        name: o.name.trim(),
        // Reject a non-finite / negative price at the gate — Infinity would crash the
        // integer insert; null ("price unknown") is the safe, valid fallback.
        priceCents:
          typeof o.priceCents === "number" && Number.isFinite(o.priceCents) && o.priceCents >= 0
            ? o.priceCents
            : null,
        sourceUrl: input.sourceUrl.trim(),
        active: true,
      })),
  };
}

/**
 * Write an operator-entered window live: insert the happy_hour + offerings, promote the venue
 * to complete + last_verified_at, and audit-log it. ATOMIC — unlike reviewQueues.ts (which only
 * toggles an existing row), this creates a NEW happy_hour + its offerings, so they must land (or
 * fail) together: a live window with orphaned/absent offerings is a corrupt visible state. Mirrors
 * the engine.ts `new_happy_hour` path (transaction + currency defaulted from the venue's city).
 * Idempotent on the natural-key unique index. Returns the new happy_hour id (or null if a duplicate
 * was swallowed).
 */
export async function createManualWindow(
  database: typeof DbInstance,
  input: ManualWindowInput,
  actor: string,
): Promise<{ happyHourId: string | null }> {
  const { hhRow, offeringRows } = buildManualWindowInsert(input);

  return database.transaction(async (tx) => {
    const inserted = await tx
      .insert(happyHours)
      .values(hhRow)
      .onConflictDoNothing()
      .returning({ id: happyHours.id });
    const happyHourId = inserted[0]?.id ?? null;
    if (!happyHourId) return { happyHourId: null }; // duplicate — nothing new to write

    if (offeringRows.length) {
      // Offerings default their currency from the venue's city, mirroring the seed pipeline
      // + engine.ts new_happy_hour path (so operator-entered offerings match AI-entered ones).
      const [v] = await tx
        .select({ cityId: venues.cityId })
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);
      const [c] = v
        ? await tx.select({ cc: cities.currencyCode }).from(cities).where(eq(cities.id, v.cityId)).limit(1)
        : [];
      const defaultCurrency = c?.cc ?? null;
      await tx
        .insert(offerings)
        .values(offeringRows.map((o) => ({ ...o, happyHourId, currencyCode: defaultCurrency })));
    }
    await tx
      .update(venues)
      .set({ dataCompleteness: "complete", lastVerifiedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(venues.id, input.venueId), eq(venues.dataCompleteness, "stub")));
    await tx.insert(auditLog).values({
      tableName: "happy_hours",
      rowId: happyHourId,
      beforeJsonb: null,
      afterJsonb: { active: true, source: "manual-entry" },
      actor,
      reason: "manual HH entry — unreadable site",
    });

    return { happyHourId };
  });
}
