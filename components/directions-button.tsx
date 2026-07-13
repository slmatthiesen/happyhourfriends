"use client";

import { directionsUrl, isApplePlatform } from "@/lib/geo/mapsLink";
import { captureOutbound } from "@/lib/observability/track";

// Apple Maps on Apple devices, Google Maps elsewhere (PRD §6.3). We deep-link
// rather than embed a map (a v1 non-goal). Styled as a plain accent link with a
// map-pin icon to match the sibling row actions — not a filled yellow CTA.
export function DirectionsButton({
  address,
  venueId,
  venueSlug,
  venueName,
  citySlug,
  stateSlug,
}: {
  address: string;
  venueId?: string;
  venueSlug?: string;
  venueName?: string;
  citySlug?: string;
  stateSlug?: string;
}) {
  function open() {
    const url = directionsUrl({ address }, null, isApplePlatform());
    captureOutbound({
      link_type: "map",
      destination_url: url,
      venue_id: venueId,
      venue_slug: venueSlug,
      venue_name: venueName,
      city_slug: citySlug,
      state_slug: stateSlug,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-cool hover:underline"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      Map
    </button>
  );
}
