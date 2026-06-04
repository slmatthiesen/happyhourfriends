import type { MetadataRoute } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { cities, neighborhoods, venues } from "@/db/schema";
import { cityPath, neighborhoodPath, venuePath } from "@/lib/routes";

// Generated at request time so `next build` doesn't depend on the DB being reachable.
export const dynamic = "force-dynamic";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/about` },
    { url: `${base}/faq` },
  ];

  const allCities = await db.select().from(cities).where(eq(cities.status, "live"));
  for (const c of allCities) {
    const hoods = await db
      .select({ id: neighborhoods.id, slug: neighborhoods.slug })
      .from(neighborhoods)
      .where(eq(neighborhoods.cityId, c.id));

    const vs = await db
      .select({
        slug: venues.slug,
        neighborhoodId: venues.neighborhoodId,
        updatedAt: venues.updatedAt,
      })
      .from(venues)
      .where(and(eq(venues.cityId, c.id), isNull(venues.deletedAt)));

    // lastModified = the freshest data the page actually shows. City rolls up all its
    // venues; each neighborhood rolls up its own. A page with no venues carries no date.
    const maxOf = (dates: Date[]): Date | undefined =>
      dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : undefined;

    const cityLastMod = maxOf(vs.map((v) => v.updatedAt));
    entries.push({
      url: `${base}${cityPath(c.state, c.slug)}`,
      changeFrequency: "daily",
      ...(cityLastMod ? { lastModified: cityLastMod } : {}),
    });

    for (const n of hoods) {
      const hoodLastMod = maxOf(
        vs.filter((v) => v.neighborhoodId === n.id).map((v) => v.updatedAt),
      );
      entries.push({
        url: `${base}${neighborhoodPath(c.state, c.slug, n.slug)}`,
        ...(hoodLastMod ? { lastModified: hoodLastMod } : {}),
      });
    }

    for (const v of vs) {
      entries.push({
        url: `${base}${venuePath(c.state, c.slug, v.slug)}`,
        lastModified: v.updatedAt,
      });
    }
  }

  return entries;
}
