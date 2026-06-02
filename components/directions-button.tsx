"use client";

import { directionsUrl, isApplePlatform } from "@/lib/geo/mapsLink";

// Apple Maps on Apple devices, Google Maps elsewhere (PRD §6.3). We deep-link
// rather than embed a map (a v1 non-goal). Styled as a plain accent link with a
// map-pin icon to match the sibling row actions — not a filled yellow CTA.
export function DirectionsButton({ address }: { address: string }) {
  function open() {
    const url = directionsUrl({ address }, null, isApplePlatform());
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
      Directions
    </button>
  );
}
