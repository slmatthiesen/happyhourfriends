import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { neighborhoods, venues } from "@/db/schema";
import {
  PromotionRow,
  type PromotionVenue,
} from "@/components/admin/promotion-row";

const isoDate = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export default async function PromotionsPage() {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      neighborhoodName: neighborhoods.name,
      promotionTier: venues.promotionTier,
      promotionStartsAt: venues.promotionStartsAt,
      promotionEndsAt: venues.promotionEndsAt,
    })
    .from(venues)
    .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id))
    .where(isNull(venues.deletedAt))
    .orderBy(asc(venues.name))
    .limit(300);

  const items: PromotionVenue[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    neighborhoodName: r.neighborhoodName,
    promotionTier: r.promotionTier,
    promotionStartsAt: isoDate(r.promotionStartsAt),
    promotionEndsAt: isoDate(r.promotionEndsAt),
  }));

  return (
    <main className="mt-8">
      <h1
        className="text-3xl text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Promotions
      </h1>
      <p className="mt-2 text-text-muted">
        Set a venue&apos;s promotion tier and run dates. No payment integration yet —
        manual control only (PRD §7, §11).
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-elevated text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Venue</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Starts</th>
              <th className="px-3 py-2 font-medium">Ends</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="text-text-primary">
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  No venues yet.
                </td>
              </tr>
            )}
            {items.map((v) => (
              <PromotionRow key={v.id} venue={v} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
