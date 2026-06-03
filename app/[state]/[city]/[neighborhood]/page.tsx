import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteWordmark } from "@/components/site-wordmark";
import { VenueTableClient } from "@/components/venue-table-client";
import {
  getCityByPath,
  getCityLastUpdatedAt,
  getNeighborhoodBySlug,
  listVenuesForCity,
} from "@/lib/queries/venues";
import { cityPath, neighborhoodPath, venuePath } from "@/lib/routes";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Full-route ISR, shared across all visitors — same model as the city page. The "Now"
// badge is client-side, so caching the render is safe. The apply engine calls
// revalidatePath on this neighborhood's path when a venue in it changes (see
// lib/cache/revalidate.ts); the 1-hour window is the backstop. generateStaticParams=[]
// keeps the DB out of `next build` while enabling the route cache.
export const revalidate = 3600; // 1 hour

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; neighborhood: string }>;
}): Promise<Metadata> {
  const { state, city, neighborhood } = await params;
  const c = await getCityByPath(state, city);
  if (!c || c.status !== "live") return { title: "Not found · Happy Hour Friends" };
  const n = await getNeighborhoodBySlug(c.id, neighborhood);
  if (!n) return { title: "Not found · Happy Hour Friends" };
  return {
    title: `${n.name} Happy Hours · ${c.name} · Happy Hour Friends`,
    description: `Happy hours in the ${n.name} neighborhood of ${c.name}${c.state ? `, ${c.state}` : ""}.`,
    alternates: { canonical: neighborhoodPath(c.state, c.slug, n.slug) },
  };
}

export default async function NeighborhoodPage({
  params,
}: {
  params: Promise<{ state: string; city: string; neighborhood: string }>;
}) {
  const { state, city: citySlug, neighborhood: hoodSlug } = await params;
  const city = await getCityByPath(state, citySlug);
  if (!city || city.status !== "live") notFound();
  const hood = await getNeighborhoodBySlug(city.id, hoodSlug);
  if (!hood) notFound();

  const [venues, lastUpdated] = await Promise.all([
    listVenuesForCity(city.id, hood.slug),
    getCityLastUpdatedAt(city.id, hood.id),
  ]);
  const venuesWithHours = venues.filter((v) => v.happyHours.length > 0);

  // ItemList for the neighborhood's happy-hour listings (see city page for rationale).
  const itemListLd =
    venuesWithHours.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${hood.name} Happy Hours`,
          numberOfItems: venuesWithHours.length,
          itemListElement: venuesWithHours.map((v, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${SITE_URL}${venuePath(city.state, city.slug, v.slug)}`,
            name: v.name,
          })),
        }
      : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      {itemListLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
        />
      ) : null}
      <SiteWordmark className="mb-6" />
      <Link href={cityPath(city.state, city.slug)} className="text-sm text-accent-cool hover:underline">
        ← All {city.name}
      </Link>
      <h1
        className="mt-3 text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {hood.name}
      </h1>
      <p className="mt-2 text-text-muted">
        Happy hours in {hood.name}, {city.name}.
      </p>

      <VenueTableClient
        stateSlug={city.state}
        citySlug={city.slug}
        cityName={`${hood.name}, ${city.name}`}
        cityTimezone={city.defaultTimezone}
        venues={venues}
        showNeighborhood={false}
        lastUpdated={lastUpdated ? lastUpdated.toISOString() : null}
      />
    </main>
  );
}
