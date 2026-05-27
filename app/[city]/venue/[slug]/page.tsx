import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DirectionsButton } from "@/components/directions-button";
import { SiteWordmark } from "@/components/site-wordmark";
import { SuggestEdit } from "@/components/submit/suggest-edit";
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
    name: `Happy Hour — ${formatDays([h.dayOfWeek])}`,
    eventSchedule: {
      "@type": "Schedule",
      repeatFrequency: "P1W",
      byDay: `https://schema.org/${SCHEMA_DOW[h.dayOfWeek]}`,
      startTime: h.startTime?.slice(0, 5),
      ...(h.endTime ? { endTime: h.endTime.slice(0, 5) } : {}),
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
                    title="Where this was sourced from"
                    className="mt-3 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted hover:border-accent-cool hover:text-accent-cool"
                  >
                    Source ↗
                  </a>
                )}
                <SuggestEdit
                  targetType="happy_hour"
                  targetId={h.id}
                  requireSource
                  summary={`Edit ${formatDays([h.dayOfWeek])} happy hour at ${venue.name}`}
                  fields={[
                    {
                      key: "startTime",
                      label: "Start time",
                      type: "time",
                      current: h.startTime?.slice(0, 5) ?? null,
                    },
                    {
                      key: "endTime",
                      label: "End time",
                      type: "time",
                      current: h.endTime?.slice(0, 5) ?? null,
                      help: "Leave blank for 'until close'.",
                    },
                    { key: "notes", label: "Notes", type: "text", current: h.notes },
                  ]}
                />
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
        <p className="mt-1 text-sm text-text-muted">
          Spotted a change? Suggest an edit and our team reviews it before anything
          goes live.
        </p>

        <div className="mt-3 space-y-2">
          <SuggestEdit
            label="Menu out of date? Send the current one (photo)"
            targetType="venue"
            targetId={venue.id}
            reportMode
            summary={`Menu update reported for ${venue.name}`}
            fields={[]}
            submitLabel="Send update"
          />
          <SuggestEdit
            label="Suggest a correction to this venue"
            targetType="venue"
            targetId={venue.id}
            summary={`Venue detail correction for ${venue.name}`}
            fields={[
              { key: "name", label: "Name", current: venue.name },
              {
                key: "websiteUrl",
                label: "Website",
                type: "url",
                current: venue.websiteUrl,
              },
              { key: "phone", label: "Phone", current: venue.phone },
            ]}
          />
          <SuggestEdit
            label="Report this place closed or no longer doing happy hour"
            targetType="venue"
            targetId={venue.id}
            critical
            requireSource
            summary={`Status change reported for ${venue.name}`}
            fields={[
              {
                key: "status",
                label: "New status",
                type: "select",
                current: venue.status,
                options: [
                  { value: "closed", label: "Permanently closed" },
                  { value: "no_happy_hour", label: "No longer has happy hour" },
                  { value: "paused", label: "Temporarily paused" },
                ],
              },
            ]}
          />
        </div>
      </section>
    </main>
  );
}
