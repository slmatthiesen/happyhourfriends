/**
 * Google Places API (New) Place Details fetch. Used by the enrich pipeline to (1) get
 * a venue's canonical website so the AI extractor starts from the right page, (2) gate
 * out non-alcohol-serving venues before any AI spend, and (3) grab a price tier + hero
 * photo for the listing. Field-masked to what we use.
 *
 * Returns null on a genuine "no data" outcome. THROWS on 429/quota — the seeder must
 * abort, not poison every remaining candidate as "no website found" (lesson from the
 * 2026-05-27 Tacoma run where a 100/day default quota silently turned 80 venues into
 * empty stubs). Requires GOOGLE_PLACES_API_KEY.
 */
const ENDPOINT = "https://places.googleapis.com/v1/places/";

/**
 * Thrown when Place Details returns 429 OR a 5xx OR an unexpected 4xx — caller
 * should stop the whole run. Silent null returns are reserved for "the API worked
 * but Google has no data for this place" (e.g. 404). Anything else throws so we
 * never again poison 80 venues with an undetected quota wall.
 */
export class PlaceDetailsQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceDetailsQuotaError";
  }
}

/** Google priceLevel enum → 1..4 (or null). */
const PRICE_LEVEL: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export interface PlaceDetails {
  websiteUri: string | null;
  phone: string | null;
  /** 1..4 general price tier (not HH pricing), or null. */
  priceLevel: number | null;
  /** True if Google says the place serves any alcohol — our happy-hour gate. */
  servesAlcohol: boolean;
  /** Photo resource name (e.g. "places/XXX/photos/YYY") for the Place Photo endpoint. */
  photoName: string | null;
  primaryType: string | null;
}

export async function fetchPlaceDetails(
  apiKey: string,
  placeId: string,
): Promise<PlaceDetails | null> {
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "websiteUri,nationalPhoneNumber,priceLevel,primaryType," +
          "servesBeer,servesWine,servesCocktails,photos",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null; // network/timeout — soft fail, candidate stays unprocessed-equivalent
  }
  // 429 = quota exhausted. Surface loudly so the seeder aborts; silently swallowing
  // it makes every subsequent candidate look like "no website on file" and corrupts
  // the whole run (2026-05-27 incident).
  if (res.status === 429) {
    const body = await res.text().catch(() => "");
    throw new PlaceDetailsQuotaError(
      `Google Places quota exhausted (429). Bump the daily quota in Cloud Console ` +
        `or wait for the daily reset. Response: ${body.slice(0, 400)}`,
    );
  }
  // 5xx = Google had a server error. Treat as fatal — don't let a transient outage
  // poison the run by marking 70 venues "no data" when really we never got an answer.
  if (res.status >= 500) {
    const body = await res.text().catch(() => "");
    throw new PlaceDetailsQuotaError(
      `Google Places server error (${res.status}). Aborting run. Response: ${body.slice(0, 400)}`,
    );
  }
  // 404 is the one "soft no" we accept — Google legitimately doesn't have this place.
  if (res.status === 404) return null;
  // Any other 4xx (auth, bad request, etc.) is a config problem, not a per-place fact.
  // Abort so it can be fixed instead of being silently swept into the stub bucket.
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PlaceDetailsQuotaError(
      `Google Places unexpected ${res.status}. Aborting run. Response: ${body.slice(0, 400)}`,
    );
  }
  try {
    const data = (await res.json()) as {
      websiteUri?: string;
      nationalPhoneNumber?: string;
      priceLevel?: string;
      primaryType?: string;
      servesBeer?: boolean;
      servesWine?: boolean;
      servesCocktails?: boolean;
      photos?: { name?: string }[];
    };
    return {
      websiteUri: data.websiteUri ?? null,
      phone: data.nationalPhoneNumber ?? null,
      priceLevel: data.priceLevel ? (PRICE_LEVEL[data.priceLevel] ?? null) : null,
      servesAlcohol: Boolean(
        data.servesBeer || data.servesWine || data.servesCocktails,
      ),
      photoName: data.photos?.[0]?.name ?? null,
      primaryType: data.primaryType ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Download a Google Place photo's bytes (follows the media redirect). Returns the
 * JPEG/PNG buffer + content type, or null. We store it locally so we never re-hit the
 * API per render. `maxWidthPx` keeps it hero-sized, not full-res.
 */
export async function fetchPlacePhoto(
  apiKey: string,
  photoName: string,
  maxWidthPx = 1200,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const url =
      `${"https://places.googleapis.com/v1/"}${photoName}/media` +
      `?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType };
  } catch {
    return null;
  }
}
