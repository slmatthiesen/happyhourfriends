"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { CityListItem } from "@/lib/queries/venues";

// Great-circle distance in km between two lat/lng points (haversine). Good enough
// to rank cities by proximity — we never display the number.
function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestCity(
  lat: number,
  lng: number,
  cities: CityListItem[],
): CityListItem | null {
  let best: CityListItem | null = null;
  let bestDist = Infinity;
  for (const c of cities) {
    if (c.centerLat == null || c.centerLng == null) continue;
    const d = distanceKm(lat, lng, c.centerLat, c.centerLng);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function CityPicker({ cities }: { cities: CityListItem[] }) {
  const router = useRouter();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCoords = cities.some(
    (c) => c.centerLat != null && c.centerLng != null,
  );

  function useMyLocation() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Your browser can't share location — pick a city below.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nearest = nearestCity(
          pos.coords.latitude,
          pos.coords.longitude,
          cities,
        );
        if (nearest) {
          router.push(`/${nearest.slug}`);
        } else {
          setLocating(false);
          setError("Couldn't match you to a city yet — pick one below.");
        }
      },
      () => {
        setLocating(false);
        setError("Location unavailable — no worries, pick a city below.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  return (
    <div className="mt-10">
      {hasCoords && (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="rounded-md bg-accent-warm px-5 py-2.5 text-sm font-medium text-bg-deep transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {locating ? "Finding the closest city…" : "Use my location"}
          </button>
          {error && (
            <p className="text-sm text-accent-hot" role="status">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="mt-8">
        <p className="text-center text-sm uppercase tracking-wide text-text-muted">
          {hasCoords ? "or pick a city" : "Pick a city"}
        </p>
        <ul className="mt-4 flex flex-wrap justify-center gap-3">
          {cities.map((c) => (
            <li key={c.id}>
              <Link
                href={`/${c.slug}`}
                className="flex items-baseline gap-2 rounded-lg border border-border bg-bg-surface px-4 py-2 transition-colors hover:bg-row-hover"
              >
                <span className="font-medium text-text-primary">
                  {c.name}
                  {c.state ? `, ${c.state}` : ""}
                </span>
                {c.venueCount > 0 && (
                  <span className="text-sm text-text-muted">
                    {c.venueCount} {c.venueCount === 1 ? "spot" : "spots"}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
