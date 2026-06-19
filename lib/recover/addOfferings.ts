/**
 * Operator add-offerings — attach deals to an EXISTING live happy-hour window that extracted
 * bare (the window was captured but the deals live in a menu image/PDF the extractor couldn't
 * fully read). The admin /admin/bare-windows bucket calls this so nothing we attempt to extract
 * is lost: a bare-but-live window becomes a reviewable, fixable item.
 *
 * Distinct from manualWindow.ts (which CREATES a window for an unreadable stub). Here the window
 * already exists and is live; we only add offerings. The operator entering the deals is the
 * verification. buildAddOfferingRows is pure + unit-tested; addOfferingsToWindow is the DB writer.
 */
import { and, eq } from "drizzle-orm";
import type { db as DbInstance } from "@/db/client";
import { venues, cities, happyHours, offerings, auditLog } from "@/db/schema";
import type { ManualOffering } from "@/lib/recover/manualWindow";

export interface AddOfferingsInput {
  happyHourId: string;
  /** First-party URL the deals were read from (the menu image/PDF/page). */
  sourceUrl: string;
  offerings: ManualOffering[];
}

export interface AddOfferingRow {
  kind: ManualOffering["kind"];
  category: ManualOffering["category"];
  name: string;
  priceCents: number | null;
  sourceUrl: string;
  active: boolean;
}

/** Pure: validate + shape the offering rows. Throws on invalid input (a bad form fails loud). */
export function buildAddOfferingRows(input: AddOfferingsInput): AddOfferingRow[] {
  if (!input.happyHourId) throw new Error("add-offerings needs a happyHourId");
  if (!input.sourceUrl || !input.sourceUrl.trim())
    throw new Error("add-offerings needs a first-party source url");
  const rows = input.offerings
    .filter((o) => o.name?.trim())
    .map((o) => ({
      kind: o.kind,
      category: o.category,
      name: o.name.trim(),
      // Reject a non-finite/negative price (Infinity would crash the integer insert) → null.
      priceCents:
        typeof o.priceCents === "number" && Number.isFinite(o.priceCents) && o.priceCents >= 0
          ? o.priceCents
          : null,
      sourceUrl: input.sourceUrl.trim(),
      active: true,
    }));
  if (rows.length === 0) throw new Error("add at least one offering with a name");
  return rows;
}

/** Offering identity used to skip re-adding a deal the window already carries (matches
 *  persistExtractedWindows' dedup: case-insensitive name + price). */
function offeringKey(name: string | null, priceCents: number | null): string {
  return `${(name ?? "").trim().toLowerCase()}|${priceCents ?? ""}`;
}

/**
 * Add operator-entered offerings to an existing LIVE window. Verifies the window is live,
 * dedups against the offerings already on it, inserts the rest (currency defaulted from the
 * venue's city, like every other write path), and audit-logs it. Returns the venue id (to
 * publish to prod) and how many were actually added.
 */
export async function addOfferingsToWindow(
  database: typeof DbInstance,
  input: AddOfferingsInput,
  actor: string,
): Promise<{ venueId: string; added: number }> {
  const built = buildAddOfferingRows(input);

  return database.transaction(async (tx) => {
    const [hh] = await tx
      .select({ id: happyHours.id, venueId: happyHours.venueId, active: happyHours.active, deletedAt: happyHours.deletedAt })
      .from(happyHours)
      .where(eq(happyHours.id, input.happyHourId))
      .limit(1);
    if (!hh) throw new Error("window not found");
    if (!hh.active || hh.deletedAt) throw new Error("window is not live (cannot add offerings to a hidden/deleted window)");

    const [v] = await tx.select({ cityId: venues.cityId }).from(venues).where(eq(venues.id, hh.venueId)).limit(1);
    const [c] = v
      ? await tx.select({ cc: cities.currencyCode }).from(cities).where(eq(cities.id, v.cityId)).limit(1)
      : [];
    const defaultCurrency = c?.cc ?? null;

    const existing = await tx
      .select({ name: offerings.name, priceCents: offerings.priceCents })
      .from(offerings)
      .where(and(eq(offerings.happyHourId, hh.id), eq(offerings.active, true)));
    const seen = new Set(existing.map((o) => offeringKey(o.name, o.priceCents)));
    const toInsert = built.filter((o) => {
      const k = offeringKey(o.name, o.priceCents);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (toInsert.length) {
      await tx.insert(offerings).values(toInsert.map((o) => ({ ...o, happyHourId: hh.id, currencyCode: defaultCurrency })));
    }
    await tx.insert(auditLog).values({
      tableName: "offerings",
      rowId: hh.id,
      beforeJsonb: null,
      afterJsonb: { happyHourId: hh.id, added: toInsert.length, source: "manual-add-offerings" },
      actor,
      reason: "operator added offerings to a bare live window",
    });

    return { venueId: hh.venueId, added: toInsert.length };
  });
}
