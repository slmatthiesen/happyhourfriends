"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CityListItem } from "@/lib/queries/venues";
import { groupCitiesByState } from "@/lib/cities/groupByState";
import { haversineMiles } from "@/lib/geo/distance";
import { setGeoIntent } from "@/lib/geo/geoIntent";
import { cityPath } from "@/lib/routes";

function nearestCity(
  lat: number,
  lng: number,
  cities: CityListItem[],
): CityListItem | null {
  let best: CityListItem | null = null;
  let bestDist = Infinity;
  for (const c of cities) {
    if (c.centerLat == null || c.centerLng == null) continue;
    const d = haversineMiles({ lat, lng }, { lat: c.centerLat, lng: c.centerLng });
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
  const stateGroups = useMemo(() => groupCitiesByState(cities), [cities]);

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
          // Hand the location intent to the city page so its venue table
          // auto-enables "Near you" without a second click.
          setGeoIntent();
          router.push(cityPath(nearest.state, nearest.slug));
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
        <div className="mt-5 flex flex-col gap-7">
          {stateGroups.map((group) => (
            <div key={group.code || "other"}>
              <p className="text-center text-xs font-medium uppercase tracking-[0.15em] text-text-muted/70">
                {group.name}
              </p>
              <ul className="mt-3 flex flex-wrap justify-center gap-3">
                {group.cities.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={cityPath(c.state, c.slug)}
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
          ))}
        </div>
      </div>
    </div>
  );
}
