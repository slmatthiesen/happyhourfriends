import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DirectionsButton } from "@/components/directions-button";
import { formatDays, formatPrice, formatTime } from "@/lib/format";
import { getCityBySlug, getVenueBySlug } from "@/lib/queries/venues";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; slug: string }>;
}): Promise<Metadata> {
  const { city, slug } = await params;
  const c = await getCityBySlug(city);
  if (!c) return { title: "Not found · Happy Hour Friends" };
  const v = await getVenueBySlug(c.id, slug);
  if (!v) return { title: "Not found · Happy Hour Friends" };
  return {
    title: `${v.name} Happy Hour · ${c.name} · Happy Hour Friends`,
    description: `Happy hour times and deals for ${v.name}${v.address ? ` — ${v.address}` : ""}.`,
  };
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ city: string; slug: string }>;
}) {
  const { city: citySlug, slug } = await params;
  const city = await getCityBySlug(citySlug);
  if (!city) notFound();
  const venue = await getVenueBySlug(city.id, slug);
  if (!venue) notFound();

  const activeHours = venue.happyHours.filter((h) => h.active && !h.deletedAt);
  const currency = city.currencyCode ?? "USD";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: venue.name,
    ...(venue.address ? { address: venue.address } : {}),
    ...(venue.websiteUrl ? { url: venue.websiteUrl } : {}),
    ...(venue.phone ? { telephone: venue.phone } : {}),
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link
        href={`/${city.slug}`}
        className="text-sm text-accent-cool hover:underline"
      >
        ← All {city.name}
      </Link>

      <header className="mt-3">
        <h1
          className="text-4xl font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {venue.name}
        </h1>
        <p className="mt-2 text-text-muted">
          {[venue.neighborhoodName, venue.address].filter(Boolean).join(" · ") ||
            "Address not yet confirmed"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {venue.address && <DirectionsButton address={venue.address} />}
          {venue.websiteUrl && (
            <a
              href={venue.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent-cool hover:underline"
            >
              Website ↗
            </a>
          )}
        </div>
      </header>

      <section className="mt-10">
        <h2
          className="text-2xl text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Happy hours
        </h2>

        {activeHours.length === 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-bg-surface p-6 text-text-muted">
            We don&apos;t have confirmed happy hour info for {venue.name} yet.{" "}
            <span className="text-accent-cool">Know it? Help us add it →</span>
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {activeHours.map((h) => (
              <li
                key={h.id}
                className="rounded-lg border border-border bg-bg-surface p-4"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-text-primary">
                    {formatDays([h.dayOfWeek])}
                  </span>
                  <span className="tabular-nums text-accent-warm">
                    {formatTime(h.startTime)} – {formatTime(h.endTime)}
                  </span>
                </div>
                {h.notes && (
                  <p className="mt-1 text-sm text-text-muted">{h.notes}</p>
                )}
                {h.offerings.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {h.offerings.map((o) => {
                      const price =
                        formatPrice(o.priceCents, o.currencyCode ?? currency) ??
                        (o.discountCents
                          ? `${formatPrice(o.discountCents, o.currencyCode ?? currency)} off`
                          : null);
                      return (
                        <li key={o.id} className="flex justify-between">
                          <span className="text-text-primary">
                            {o.name ?? o.category}
                            {o.conditions && (
                              <span className="text-text-muted"> · {o.conditions}</span>
                            )}
                          </span>
                          {price && (
                            <span className="tabular-nums text-accent-warm">
                              {price}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {h.sourceUrl && (
                  <a
                    href={h.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block text-xs text-text-muted hover:text-accent-cool"
                  >
                    Where did this come from? ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
