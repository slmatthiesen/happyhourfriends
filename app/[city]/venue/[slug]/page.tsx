import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DirectionsButton } from "@/components/directions-button";
import { SiteWordmark } from "@/components/site-wordmark";
import { AddHappyHour } from "@/components/submit/add-happy-hour";
import { ReportChange } from "@/components/submit/report-change";
import { formatDays, formatDaysLong, formatPrice, formatWindow } from "@/lib/format";
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

  // Most venues run the identical happy hour across several days (Mon–Fri is the
  // common case). Collapse days that share the same window + offerings into one
  // card so the listing isn't a noisy day-by-day repeat.
  const offeringSig = (offerings: (typeof activeHours)[number]["offerings"]) =>
    offerings
      .map(
        (o) =>
          `${o.name ?? o.category}|${o.priceCents ?? ""}|${o.discountCents ?? ""}|${o.conditions ?? ""}|${o.currencyCode ?? ""}`,
      )
      .sort()
      .join(";");

  type HourGroup = {
    days: number[];
    rep: (typeof activeHours)[number];
  };
  const hourGroups = new Map<string, HourGroup>();
  for (const h of activeHours) {
    const sig = `${h.allDay}|${h.startTime}|${h.endTime}|${h.notes ?? ""}|${offeringSig(h.offerings)}`;
    const group = hourGroups.get(sig);
    if (group) group.days.push(...h.daysOfWeek);
    else hourGroups.set(sig, { days: [...h.daysOfWeek], rep: h });
  }
  const groupedHours = [...hourGroups.values()].sort(
    (a, b) => Math.min(...a.days) - Math.min(...b.days),
  );

  // Venue-level source: the first sourced happy hour (they usually share one).
  const sourceUrl =
    activeHours.find((h) => h.sourceUrl)?.sourceUrl ??
    venue.happyHours.find((h) => h.sourceUrl)?.sourceUrl ??
    null;

  // Schema.org recurring Event per happy-hour window (PRD §6.5). A weekly Schedule
  // models the recurrence; offerings become the event description.
  const SCHEMA_DOW: Record<number, string> = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
  };
  const events = activeHours.map((h) => ({
    "@type": "Event",
    name: `Happy Hour — ${formatDays(h.daysOfWeek)}`,
    eventSchedule: {
      "@type": "Schedule",
      repeatFrequency: "P1W",
      byDay: h.daysOfWeek.map((d) => `https://schema.org/${SCHEMA_DOW[d]}`),
      ...(h.allDay
        ? {}
        : {
            startTime: h.startTime!.slice(0, 5),
            ...(h.endTime ? { endTime: h.endTime.slice(0, 5) } : {}),
          }),
    },
    location: {
      "@type": "Restaurant",
      name: venue.name,
      ...(venue.address ? { address: venue.address } : {}),
    },
    ...(h.offerings.length
      ? { description: h.offerings.map((o) => o.name ?? o.category).join(", ") }
      : {}),
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: venue.name,
    ...(venue.address ? { address: venue.address } : {}),
    ...(venue.websiteUrl ? { url: venue.websiteUrl } : {}),
    ...(venue.phone ? { telephone: venue.phone } : {}),
    ...(events.length ? { event: events } : {}),
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteWordmark className="mb-6" />
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
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Where this listing's happy hour info was sourced from"
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm text-text-muted hover:border-accent-cool hover:text-accent-cool"
            >
              Source ↗
            </a>
          )}
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
          {venue.otherUrl && (
            <a
              href={venue.otherUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent-cool hover:underline"
            >
              Social / menu ↗
            </a>
          )}
          {venue.phone && (
            <a
              href={`tel:${venue.phone}`}
              className="text-sm text-accent-cool hover:underline"
            >
              {venue.phone}
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
          <div
            id="add-happy-hour"
            className="mt-4 rounded-lg border border-border bg-bg-surface p-6"
          >
            <p className="text-text-muted">
              We don&apos;t have confirmed happy hour info for {venue.name} yet. Know
              it? Help us add it — paste a link or upload a photo of the menu, and
              fill in whatever details you have. An operator reviews everything
              before it goes live.
            </p>
            <div className="mt-4">
              <AddHappyHour venueId={venue.id} venueName={venue.name} />
            </div>
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {groupedHours.map(({ days, rep: h }) => (
              <li
                key={h.id}
                className="rounded-lg border border-border bg-bg-surface p-4"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-text-primary">
                    {formatDaysLong(days)}
                  </span>
                  <span className="tabular-nums text-accent-warm">
                    {formatWindow(h)}
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2
          className="text-xl text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Keep this listing accurate
        </h2>
        <p className="mt-1 mb-3 text-sm text-text-muted">
          Prices changed? New deal? Closed? Just tell us in plain words — our AI sorts
          out the details and a human approves it before anything goes live.
        </p>

        <ReportChange venueId={venue.id} venueName={venue.name} />
      </section>
    </main>
  );
}
