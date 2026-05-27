import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCityBySlug,
  listNeighborhoods,
  listVenuesForCity,
  type VenueListItem,
} from "@/lib/queries/venues";
import { formatDays, formatTime } from "@/lib/format";

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

function windowBounds(v: VenueListItem) {
  const starts = v.happyHours.map((h) => h.startTime).sort();
  const ends = v.happyHours
    .map((h) => h.endTime)
    .filter((e): e is string => e != null)
    .sort();
  return {
    days: formatDays(v.happyHours.map((h) => h.dayOfWeek)),
    start: starts[0] ?? null,
    end: ends.length ? ends[ends.length - 1] : null,
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
  const withHours = venues.filter((v) => v.happyHours.length > 0);
  const stubs = venues.filter((v) => v.happyHours.length === 0);

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
          {withHours.length > 0
            ? `${withHours.length} ${withHours.length === 1 ? "venue" : "venues"} with happy hours`
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

      {venues.length === 0 ? (
        <div className="mt-12 rounded-lg border border-border bg-bg-surface p-10 text-center">
          <p className="text-lg text-text-primary">No venues listed yet.</p>
          <p className="mt-2 text-text-muted">
            We add venues only with a verifiable source — no guesses. Seeding is in
            progress.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-border">
          <table className="tabular-nums w-full text-left text-sm">
            <thead className="bg-bg-elevated text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Venue</th>
                <th className="px-4 py-2 font-medium">Neighborhood</th>
                <th className="px-4 py-2 font-medium">Days</th>
                <th className="px-4 py-2 font-medium">Start</th>
                <th className="px-4 py-2 font-medium">End</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              {withHours.map((v) => {
                const b = windowBounds(v);
                const promoted = v.promotionTier !== "none";
                return (
                  <tr
                    key={v.id}
                    className="border-t border-border hover:bg-row-hover"
                    style={
                      promoted
                        ? {
                            backgroundColor: "var(--row-promoted)",
                            borderLeft: "3px solid var(--accent-warm)",
                          }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/${city.slug}/venue/${v.slug}`}
                        className="hover:text-accent-cool"
                      >
                        {v.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {v.neighborhoodName ?? "—"}
                    </td>
                    <td className="px-4 py-3">{b.days}</td>
                    <td className="px-4 py-3 text-accent-warm">
                      {formatTime(b.start)}
                    </td>
                    <td className="px-4 py-3">{formatTime(b.end)}</td>
                  </tr>
                );
              })}

              {stubs.map((v) => (
                <tr
                  key={v.id}
                  className="border-t border-border text-text-muted hover:bg-row-hover"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/${city.slug}/venue/${v.slug}`}
                      className="hover:text-accent-cool"
                    >
                      {v.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{v.neighborhoodName ?? "—"}</td>
                  <td className="px-4 py-3 text-accent-cool" colSpan={3}>
                    Does this place have a happy hour? Help us add it →
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
