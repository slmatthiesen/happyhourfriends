export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle (haversine) distance between two points, in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

const METERS_PER_MILE = 1609.344;

/** Great-circle (haversine) distance between two points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  return haversineMiles(a, b) * METERS_PER_MILE;
}

/** "< 0.1 mi" under a tenth of a mile, otherwise one decimal e.g. "0.4 mi". */
export function formatDistance(mi: number): string {
  if (mi < 0.1) return "< 0.1 mi";
  return `${mi.toFixed(1)} mi`;
}
