import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteWordmark } from "@/components/site-wordmark";
import { VenueTableClient } from "@/components/venue-table-client";
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
  const stubs = venues.length - withHours;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <SiteWordmark className="mb-6" />
      <header>
        <h1
          className="text-4xl font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {city.name} happy hours
        </h1>
        <p className="mt-2 text-text-muted">
          {withHours > 0 || stubs > 0 ? (
            <>
              <span className="text-text-primary">{withHours}</span>{" "}
              {withHours === 1 ? "venue" : "venues"} with happy hours
              {stubs > 0 && (
                <>
                  {" · "}
                  <span className="text-text-primary">{stubs}</span>{" "}
                  stub{stubs === 1 ? "" : "s"} needing help
                </>
              )}
            </>
          ) : (
            "We're still gathering happy hours here — help us fill it in."
          )}
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

      {/* How-it-works nudge: the photo loop is the social engine — the more people
          snap menus when they spot drift, the better the listings get for everyone. */}
      <aside
        className="mt-6 flex items-start gap-3 rounded-lg border border-accent-cool/30 bg-accent-cool/5 px-4 py-3 text-sm text-text-muted"
        aria-label="How submissions work"
      >
        <span aria-hidden="true" className="text-lg leading-none">📸</span>
        <p className="leading-snug">
          <span className="font-medium text-text-primary">See something wrong?</span>{" "}
          Snap a pic of the happy-hour menu and submit it on the venue&apos;s page —
          your photo becomes the shared source of truth for everyone in your
          neighborhood.
        </p>
      </aside>

      <VenueTableClient
        citySlug={city.slug}
        cityName={city.name}
        cityTimezone={city.defaultTimezone}
        venues={venues}
      />

      <p className="mt-6 text-sm text-text-muted">
        Know a spot we&apos;re missing?{" "}
        <Link
          href={`/submit/new-venue?city=${city.slug}`}
          className="text-accent-cool hover:underline"
        >
          Add a venue →
        </Link>
      </p>
    </main>
  );
}
