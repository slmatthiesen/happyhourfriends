import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteWordmark } from "@/components/site-wordmark";
import { VenueTableClient } from "@/components/venue-table-client";
import { getCityByPath, listVenuesForCity } from "@/lib/queries/venues";
import { cityPath } from "@/lib/routes";

// Cache the rendered page (HTML + RSC payload) in Next's shared server-side cache and
// regenerate at most once an hour — every visitor gets the same cached page, so the
// venue/hours queries don't run per request. Safe to cache the render because the live
// "Now" badge is computed client-side (see venue-table-client.tsx), so a cached page
// never freezes "happening now". This is a dynamic route with no generateStaticParams,
// so nothing is prerendered at build — the DB is never touched during `next build`.
export const revalidate = 3600; // 1 hour

// Returning [] prerenders no city at build (keeps the DB out of `next build`) while
// still opting the route into the full-route cache: with dynamicParams=true (default),
// each city is rendered on first request and then cached/served statically until the
// `revalidate` window lapses. `revalidate` alone left the route fully dynamic.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string }>;
}): Promise<Metadata> {
  const { state, city } = await params;
  const c = await getCityByPath(state, city);
  if (!c || c.status !== "live") return { title: "Not found · Happy Hour Friends" };
  return {
    title: `${c.name} Happy Hours · Happy Hour Friends`,
    description: `Every happy hour in ${c.name}${c.state ? `, ${c.state}` : ""}, in one sortable table. Every detail traces to a source.`,
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ state: string; city: string }>;
}) {
  const { state, city: citySlug } = await params;
  const city = await getCityByPath(state, citySlug);
  if (!city || city.status !== "live") notFound();

  const venues = await listVenuesForCity(city.id);
  const withHours = venues.filter((v) => v.happyHours.length > 0).length;

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
          {withHours > 0 ? (
            <>
              <span className="text-text-primary">{withHours}</span>{" "}
              happy hour {withHours === 1 ? "spot" : "spots"} in {city.name}
            </>
          ) : (
            "We're still gathering happy hours here — help us fill it in."
          )}
        </p>
      </header>

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
        stateSlug={city.state}
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
