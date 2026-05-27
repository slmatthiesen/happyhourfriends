import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteWordmark } from "@/components/site-wordmark";
import { VenueTableClient } from "@/components/venue-table-client";
import {
  getCityBySlug,
  getNeighborhoodBySlug,
  listVenuesForCity,
} from "@/lib/queries/venues";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; neighborhood: string }>;
}): Promise<Metadata> {
  const { city, neighborhood } = await params;
  const c = await getCityBySlug(city);
  if (!c) return { title: "Not found · Happy Hour Friends" };
  const n = await getNeighborhoodBySlug(c.id, neighborhood);
  if (!n) return { title: "Not found · Happy Hour Friends" };
  return {
    title: `${n.name} Happy Hours · ${c.name} · Happy Hour Friends`,
    description: `Happy hours in the ${n.name} neighborhood of ${c.name}${c.state ? `, ${c.state}` : ""}.`,
  };
}

export default async function NeighborhoodPage({
  params,
}: {
  params: Promise<{ city: string; neighborhood: string }>;
}) {
  const { city: citySlug, neighborhood: hoodSlug } = await params;
  const city = await getCityBySlug(citySlug);
  if (!city) notFound();
  const hood = await getNeighborhoodBySlug(city.id, hoodSlug);
  if (!hood) notFound();

  const venues = await listVenuesForCity(city.id, hood.slug);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <SiteWordmark className="mb-6" />
      <Link href={`/${city.slug}`} className="text-sm text-accent-cool hover:underline">
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

      <VenueTableClient citySlug={city.slug} venues={venues} showNeighborhood={false} />
    </main>
  );
}
