/**
 * Airport-terminal exclusion for seed discovery. In-terminal restaurants/bars aren't
 * the local spots we feature. Detection is generic + zero-curation: the discovery run
 * looks up airport place points via the Places API, then drops any candidate within a
 * tight buffer of one. The buffer is deliberately small (terminal/concourse footprint)
 * so a real bar NEAR an airport — e.g. Tacoma's "Airport Tavern", ~10km from SEA-TAC —
 * is NOT dropped, which a name regex on "airport" would wrongly do.
 */
import { haversineMeters, type LatLng } from "@/lib/geo/distance";

/** A discovery candidate / airport point. Alias of the shared geo LatLng. */
export type GeoPoint = LatLng;

/** Tight buffer: terminal/concourse footprint only, not the surrounding area. */
export const AIRPORT_BUFFER_METERS = 1500;

/**
 * True when (lat,lng) is within `bufferMeters` of any known airport point. Empty
 * `airports` → always false (gate is a no-op when the lookup found nothing).
 */
export function isWithinAirportBuffer(
  lat: number,
  lng: number,
  airports: GeoPoint[],
  bufferMeters: number = AIRPORT_BUFFER_METERS,
): boolean {
  const point: LatLng = { lat, lng };
  return airports.some((a) => haversineMeters(point, a) <= bufferMeters);
}
