import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLinkButton } from "@/components/copy-link-button";
import { DirectionsButton } from "@/components/directions-button";
import { SignalButton } from "@/components/signal/signal-button";
import { SiteWordmark } from "@/components/site-wordmark";
import { Contribute } from "@/components/submit/contribute";
import { VenueLiveDot } from "@/components/venue-live-dot";
import { ReportClosed } from "@/components/submit/report-closed";
import { formatDays, formatDaysLong, formatPrice, formatWindowByDay } from "@/lib/format";
import { getCityByPath, getVenueBySlug } from "@/lib/queries/venues";
import { cityPath, venuePath } from "@/lib/routes";
import { breadcrumbListLd } from "@/lib/seo/structuredData";
import { labelForVenueType } from "@/lib/places/venueType";
import { uiFlags } from "@/lib/ui/flags";
import { sourceMeta } from "@/lib/ui/sourceLink";

// Absolute base so the copied link is canonical, not request-host-relative.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Full-route ISR, shared across all visitors. Safe to cache the render: the venue page
// has no server-side time logic (the live "Now" state lives in the client grid), so a
// cached page never goes stale on the clock. On-demand `revalidatePath` from the apply
// engine refreshes a venue immediately when the AI or an admin edits it (see
// lib/cache/revalidate.ts), so the 1-hour window is just the backstop for anything that
// bypasses the engine. generateStaticParams=[] keeps the DB out of `next build` while
// opting the route into the cache (bare `revalidate` alone leaves it fully dynamic).
export const revalidate = 3600; // 1 hour

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; slug: string }>;
}): Promise<Metadata> {
  const { state, city, slug } = await params;
  const c = await getCityByPath(state, city);
  if (!c || c.status !== "live") return { title: "Not found · Happy Hour Friends" };
  const v = await getVenueBySlug(c.id, slug);
  if (!v) return { title: "Not found · Happy Hour Friends" };
  // Only an active venue with a real, live happy hour earns indexing. Stubs (no active HH)
  // are thin "help-wanted" pages, and closed/paused venues answer no search — the sitemap
  // omits both, but Google still finds them via internal links, so noindex keeps them out.
  // follow:true preserves link equity to the real pages they link to.
  const hasActiveHappyHour = v.happyHours.some((h) => h.active && !h.deletedAt);
  const isClosed = v.status === "closed";
  const indexable = v.status === "active" && hasActiveHappyHour;
  return {
    title: isClosed
      ? `${v.name} — Permanently closed · ${c.name} · Happy Hour Friends`
      : `${v.name} Happy Hour · ${c.name} · Happy Hour Friends`,
    description: isClosed
      ? `${v.name}${v.address ? ` (${v.address})` : ""} is permanently closed.`
      : `Happy hour times and deals for ${v.name}${v.address ? ` — ${v.address}` : ""}.`,
    alternates: { canonical: venuePath(c.state, c.slug, v.slug) },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ state: string; city: string; slug: string }>;
}) {
  const { state, city: citySlug, slug } = await params;
  const city = await getCityByPath(state, citySlug);
  if (!city || city.status !== "live") notFound();
  const venue = await getVenueBySlug(city.id, slug);
  if (!venue) notFound();

  const activeHours = venue.happyHours.filter((h) => h.active && !h.deletedAt);
  const isClosed = venue.status === "closed";
  const currency = city.currencyCode ?? "USD";

  // "Last updated" reflects any change to the displayed data, not just the venue row:
  // the max of the venue's updatedAt and every happy-hour + offering updatedAt. Deal
  // data lives in separate rows, so an offering-only edit still bumps the date.
  const lastUpdated = [
    venue.updatedAt,
    ...venue.happyHours.flatMap((h) => [
      h.updatedAt,
      ...h.offerings.map((o) => o.updatedAt),
    ]),
  ]
    .filter((d): d is Date => d != null)
    .reduce<Date | null>((max, d) => (max == null || d > max ? d : max), null);

  // Most venues run the identical happy hour across several days (Mon–Fri is the
  // common case). Collapse days that share the same window + offerings into one
  // card so the listing isn't a noisy day-by-day repeat.
  const offeringSig = (offerings: (typeof activeHours)[number]["offerings"]) =>
    offerings
      .map(
        (o) =>
          `${o.name ?? o.category}|${o.priceCents ?? ""}|${o.discountCents ?? ""}|${o.discountPercent ?? ""}|${o.conditions ?? ""}|${o.currencyCode ?? ""}`,
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
  // Name WHAT the source is (reader photo / menu image / PDF / web page) so the reader
  // knows where the link goes before clicking.
  const source = sourceUrl ? sourceMeta(sourceUrl) : null;

  // Restaurant structured data. We intentionally do NOT emit schema.org `Event` nodes for
  // happy-hour windows: Event requires a `startDate` (a dated occurrence), which a perpetual
  // weekly happy hour doesn't have — that mismatch is what Google Search Console flags as a
  // missing-startDate error, with organizer/performer/eventStatus/image/offers as warnings.
  // A recurring restaurant deal isn't the dated, ticketed thing Event models, so we describe
  // the venue with real fields we actually hold and leave the HH windows as on-page content.
  const SCHEMA_DOW: Record<number, string> = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
  };
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  // Google Place price tier 1–4 → the $–$$$$ range Google recognizes.
  const priceRange =
    venue.priceLevel && venue.priceLevel >= 1 && venue.priceLevel <= 4
      ? "$".repeat(venue.priceLevel)
      : null;
  // Only periods with a known close map cleanly to opens/closes; skip 24h/unknown-close ones
  // rather than guess a close time.
  const openingHoursSpecification = (venue.hoursJson ?? [])
    .filter((p) => p.closeMin != null && SCHEMA_DOW[p.openDay])
    .map((p) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${SCHEMA_DOW[p.openDay]}`,
      opens: hhmm(p.openMin),
      closes: hhmm(p.closeMin as number),
    }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: venue.name,
    ...(venue.address ? { address: venue.address } : {}),
    ...(venue.websiteUrl ? { url: venue.websiteUrl } : {}),
    ...(venue.phone ? { telephone: venue.phone } : {}),
    ...(venue.lat && venue.lng
      ? { geo: { "@type": "GeoCoordinates", latitude: venue.lat, longitude: venue.lng } }
      : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(venue.heroImageUrl ? { image: `${SITE_URL}${venue.heroImageUrl}` } : {}),
    ...(openingHoursSpecification.length ? { openingHoursSpecification } : {}),
  };

  const breadcrumbLd = breadcrumbListLd([
    { name: "Happy Hour Friends", path: "/" },
    { name: city.name, path: cityPath(city.state, city.slug) },
    { name: venue.name, path: venuePath(city.state, city.slug, venue.slug) },
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <nav className="mb-8 flex items-center justify-between gap-4">
        <SiteWordmark className="text-base font-semibold text-text-primary" />
        <Link
          href={cityPath(city.state, city.slug)}
          className="shrink-0 text-base font-semibold text-accent-cool hover:underline"
        >
          ← All {city.name}
        </Link>
      </nav>

      {isClosed && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          Permanently closed — {venue.name} has closed and is no longer serving happy hours.
        </div>
      )}

      <header className="mt-3 rounded-lg border border-border bg-bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <h1
            className="text-4xl font-semibold text-text-primary"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {venue.name}
          </h1>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {lastUpdated && (
              <p className="text-right text-xs text-text-muted">
                Updated{" "}
                {lastUpdated.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                })}
              </p>
            )}
            {uiFlags.signals && (
              <SignalButton venueId={venue.id} initialCount={venue.signalCount} />
            )}
          </div>
        </div>
        {labelForVenueType(venue.type) && (
          <span className="mt-3 inline-block rounded-full border border-border bg-bg-elevated px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-text-muted">
            {labelForVenueType(venue.type)}
          </span>
        )}
        <p className="mt-2 text-text-muted">
          {[venue.neighborhoodName, venue.address].filter(Boolean).join(" · ") ||
            "Address not yet confirmed"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          {venue.address && <DirectionsButton address={venue.address} />}
          {venue.websiteUrl && (
            <a
              href={venue.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-accent-cool hover:underline"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Website
            </a>
          )}
          {venue.otherUrl && (
            <a
              href={venue.otherUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-accent-cool hover:underline"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Social / menu
            </a>
          )}
          {venue.phone && (
            <a
              href={`tel:${venue.phone}`}
              className="inline-flex items-center gap-1.5 text-sm text-accent-cool hover:underline"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              {venue.phone}
            </a>
          )}
          {sourceUrl && source && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={source.title}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-text-muted hover:border-accent-cool hover:text-accent-cool"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {source.kind === "reader-photo" || source.kind === "image" ? (
                  <>
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </>
                ) : source.kind === "pdf" ? (
                  <>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </>
                ) : (
                  <>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M16 13H8" />
                    <path d="M16 17H8" />
                  </>
                )}
              </svg>
              {source.label}
            </a>
          )}
        </div>
        {/* Our-page action on its own line — the row above is all about the business. */}
        {uiFlags.copyLink && (
          <div className="mt-2">
            <CopyLinkButton
              url={new URL(venuePath(city.state, city.slug, venue.slug), SITE_URL).toString()}
            />
          </div>
        )}
      </header>

      {!isClosed && (
      <section className="mt-10">
        <div className="flex items-center gap-3">
          <h2
            className="text-2xl text-text-primary"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Happy hours
          </h2>
          <VenueLiveDot
            happyHours={activeHours}
            hoursJson={venue.hoursJson ?? null}
            timezone={venue.timezone ?? city.defaultTimezone}
          />
        </div>

        {activeHours.length > 0 && (
          <p className="mt-2 text-xs text-text-muted">
            Happy hours change. If we are behind, please help your friends — snap a pic and upload a photo of the current menu 📸
          </p>
        )}

        {activeHours.length === 0 ? (
          <div id="add-happy-hour" className="mt-4 rounded-lg border border-border bg-bg-surface p-6">
            <p className="text-text-muted">
              We don&apos;t have confirmed happy hour info for {venue.name} yet.
            </p>
            <div className="mt-4">
              <Contribute venueId={venue.id} venueName={venue.name} hasHappyHour={false} />
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <ReportClosed venueId={venue.id} venueName={venue.name} />
            </div>
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {groupedHours.map(({ days, rep: h }) => {
              const lines = formatWindowByDay(
                { allDay: h.allDay, startTime: h.startTime, endTime: h.endTime, daysOfWeek: days },
                venue.hoursJson,
              );
              return (
              <li
                key={h.id}
                className="rounded-lg border border-border bg-bg-surface p-4 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.45)]"
              >
                <div className="space-y-1">
                  {lines.map((ln) => (
                    <div key={ln.days.join(",")} className="flex items-baseline justify-between">
                      <span className="font-medium text-text-primary">
                        <span className="sm:hidden">{formatDays(ln.days)}</span>
                        <span className="hidden sm:inline">{formatDaysLong(ln.days)}</span>
                      </span>
                      <span className="tabular-nums text-accent-warm">{ln.bounds}</span>
                    </div>
                  ))}
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
                          : o.discountPercent
                            ? `${o.discountPercent}% off`
                            : null);
                      // Don't repeat a description that just restates the name (case-insensitive).
                      const showDesc =
                        o.description &&
                        o.description.trim().toLowerCase() !== (o.name ?? "").trim().toLowerCase();
                      return (
                        <li key={o.id} className="flex flex-col gap-0.5">
                          <div className="flex justify-between">
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
                          </div>
                          {showDesc && (
                            <span className="text-xs text-text-muted">{o.description}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      {!isClosed && activeHours.length > 0 && (
        <section className="mt-12 border-t border-border pt-8">
          <h2 className="text-xl text-text-primary" style={{ fontFamily: "var(--font-serif)" }}>
            Keep this listing accurate
          </h2>
          <p className="mt-1 mb-3 text-sm text-text-muted">
            Prices changed? New deal? Closed? Just tell us in plain words — our AI sorts out
            the details and a human approves it before anything goes live.
          </p>
          <Contribute venueId={venue.id} venueName={venue.name} hasHappyHour={true} />
          <div className="mt-4">
            <ReportClosed venueId={venue.id} venueName={venue.name} />
          </div>
        </section>
      )}
    </main>
  );
}
