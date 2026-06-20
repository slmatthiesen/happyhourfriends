import type { MetadataRoute } from "next";
import { and, eq, isNull, exists } from "drizzle-orm";
import { db } from "@/db/client";
import { cities, venues, happyHours } from "@/db/schema";
import { cityPath, venuePath } from "@/lib/routes";

// Generated at request time so `next build` doesn't depend on the DB being reachable.
export const dynamic = "force-dynamic";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily" },
    { url: `${base}/about` },
    { url: `${base}/faq` },
  ];

  const allCities = await db.select().from(cities).where(eq(cities.status, "live"));
  for (const c of allCities) {
    // Index ONLY venues with a real, live happy hour — not help-wanted stubs. Thin
    // stub pages (no HH) dilute the index and add no search value; the venue list and
    // the city's lastModified date below both flow from this set. Neighborhood pages
    // are intentionally omitted — they're orphaned (no inbound links) and mostly thin,
    // so submitting them just stalls them in "Discovered – currently not indexed".
    const vs = await db
      .select({
        slug: venues.slug,
        updatedAt: venues.updatedAt,
      })
      .from(venues)
      .where(
        and(
          eq(venues.cityId, c.id),
          isNull(venues.deletedAt),
          exists(
            db
              .select({ id: happyHours.id })
              .from(happyHours)
              .where(
                and(
                  eq(happyHours.venueId, venues.id),
                  eq(happyHours.active, true),
                  isNull(happyHours.deletedAt),
                ),
              ),
          ),
        ),
      );

    // lastModified = the freshest data the page actually shows: the max updatedAt across
    // the city's live happy-hour venues. A city with no such venues carries no date.
    const maxOf = (dates: Date[]): Date | undefined =>
      dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : undefined;

    const cityLastMod = maxOf(vs.map((v) => v.updatedAt));
    entries.push({
      url: `${base}${cityPath(c.state, c.slug)}`,
      changeFrequency: "daily",
      ...(cityLastMod ? { lastModified: cityLastMod } : {}),
    });

    for (const v of vs) {
      entries.push({
        url: `${base}${venuePath(c.state, c.slug, v.slug)}`,
        lastModified: v.updatedAt,
      });
    }
  }

  return entries;
}
