import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VenueTable } from "@/components/venue-table";
import {
  getCityBySlug,
  listNeighborhoods,
  listVenuesForCity,
} from "@/lib/queries/venues";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const c = await getCityBySlug(city);
  if (!c) return { title: "Not found · Happy Hour Friends" };
  return {
    title: `${c.name} Happy Hours · Happy Hour Friends`,
    description: `Every happy hour in ${c.name}${c.state ? `, ${c.state}` : ""}, in one sortable table. Every detail traces to a source.`,
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: citySlug } = await params;
  const city = await getCityBySlug(citySlug);
  if (!city) notFound();

  const [venues, hoods] = await Promise.all([
    listVenuesForCity(city.id),
    listNeighborhoods(city.id),
  ]);
  const withHours = venues.filter((v) => v.happyHours.length > 0).length;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <header>
        <h1
          className="text-4xl font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {city.name} happy hours
        </h1>
        <p className="mt-2 text-text-muted">
          {withHours > 0
            ? `${withHours} ${withHours === 1 ? "venue" : "venues"} with happy hours`
            : "We're still gathering happy hours here — help us fill it in."}
        </p>
      </header>

      {hoods.length > 0 && (
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Neighborhoods">
          {hoods.map((n) => (
            <Link
              key={n.id}
              href={`/${city.slug}/${n.slug}`}
              className="rounded-full border border-border px-3 py-1 text-sm text-text-muted transition-colors hover:bg-row-hover hover:text-text-primary"
            >
              {n.name}
            </Link>
          ))}
        </nav>
      )}

      <VenueTable citySlug={city.slug} venues={venues} />
    </main>
  );
}
