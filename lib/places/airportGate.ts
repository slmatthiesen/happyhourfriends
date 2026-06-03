/**
 * Airport-terminal exclusion for seed discovery. In-terminal restaurants/bars aren't
 * the local spots we feature. Detection is generic + zero-curation: the discovery run
 * looks up airport place points via the Places API, then drops any candidate within a
 * tight buffer of one. The buffer is deliberately small (terminal/concourse footprint)
 * so a real bar NEAR an airport — e.g. Tacoma's "Airport Tavern", ~10km from SEA-TAC —
 * is NOT dropped, which a name regex on "airport" would wrongly do.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Tight buffer: terminal/concourse footprint only, not the surrounding area. */
export const AIRPORT_BUFFER_METERS = 1500;

/** Great-circle distance in metres. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

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
  return airports.some((a) => haversineMeters(lat, lng, a.lat, a.lng) <= bufferMeters);
}
