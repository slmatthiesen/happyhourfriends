import type { LatLng } from "@/lib/geo/distance";

export type MapDestination = LatLng | { address: string };

function destToken(dest: MapDestination): string {
  return "address" in dest
    ? encodeURIComponent(dest.address)
    : `${dest.lat},${dest.lng}`;
}

/**
 * Deep-link to a maps app. Apple Maps on Apple platforms, Google Maps elsewhere
 * (deep-link only — embedding a map is a v1 non-goal). With an `origin`, returns a
 * directions URL (origin → destination); without one, a search/query URL for the
 * destination only.
 */
export function directionsUrl(
  dest: MapDestination,
  origin: LatLng | null,
  isApple: boolean,
): string {
  const d = destToken(dest);
  if (isApple) {
    return origin
      ? `https://maps.apple.com/?saddr=${origin.lat},${origin.lng}&daddr=${d}`
      : `https://maps.apple.com/?q=${d}`;
  }
  return origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${d}`
    : `https://www.google.com/maps/search/?api=1&query=${d}`;
}

/** UA test for Apple platforms (same heuristic the DirectionsButton used). */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Mac/.test(navigator.userAgent);
}
