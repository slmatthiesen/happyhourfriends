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
    entries.push({ url: `${base}${cityPath(c.state ?? "", c.slug)}`, changeFrequency: "daily" });

    const hoods = await db
      .select({ slug: neighborhoods.slug })
      .from(neighborhoods)
      .where(eq(neighborhoods.cityId, c.id));
    for (const n of hoods) entries.push({ url: `${base}${neighborhoodPath(c.state ?? "", c.slug, n.slug)}` });

    const vs = await db
      .select({ slug: venues.slug })
      .from(venues)
      .where(and(eq(venues.cityId, c.id), isNull(venues.deletedAt)));
    for (const v of vs) {
      entries.push({ url: `${base}${venuePath(c.state ?? "", c.slug, v.slug)}` });
    }
  }

  return entries;
}
