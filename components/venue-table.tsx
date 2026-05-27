import Link from "next/link";
import { formatDays, formatTime } from "@/lib/format";
import type { VenueListItem } from "@/lib/queries/venues";

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

export function VenueTable({
  citySlug,
  venues,
  showNeighborhood = true,
}: {
  citySlug: string;
  venues: VenueListItem[];
  showNeighborhood?: boolean;
}) {
  if (venues.length === 0) {
    return (
      <div className="mt-12 rounded-lg border border-border bg-bg-surface p-10 text-center">
        <p className="text-lg text-text-primary">No venues listed yet.</p>
        <p className="mt-2 text-text-muted">
          We add venues only with a verifiable source — no guesses.
        </p>
      </div>
    );
  }

  const withHours = venues.filter((v) => v.happyHours.length > 0);
  const stubs = venues.filter((v) => v.happyHours.length === 0);

  return (
    <div className="mt-8 overflow-x-auto rounded-lg border border-border">
      <table className="tabular-nums w-full text-left text-sm">
        <thead className="bg-bg-elevated text-text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Venue</th>
            {showNeighborhood && (
              <th className="px-4 py-2 font-medium">Neighborhood</th>
            )}
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
                    href={`/${citySlug}/venue/${v.slug}`}
                    className="hover:text-accent-cool"
                  >
                    {v.name}
                  </Link>
                </td>
                {showNeighborhood && (
                  <td className="px-4 py-3 text-text-muted">
                    {v.neighborhoodName ?? "—"}
                  </td>
                )}
                <td className="px-4 py-3">{b.days}</td>
                <td className="px-4 py-3 text-accent-warm">{formatTime(b.start)}</td>
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
                  href={`/${citySlug}/venue/${v.slug}`}
                  className="hover:text-accent-cool"
                >
                  {v.name}
                </Link>
              </td>
              {showNeighborhood && (
                <td className="px-4 py-3">{v.neighborhoodName ?? "—"}</td>
              )}
              <td className="px-4 py-3 text-accent-cool" colSpan={showNeighborhood ? 3 : 2}>
                Does this place have a happy hour? Help us add it →
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
