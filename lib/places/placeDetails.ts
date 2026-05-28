/**
 * Google Places API (New) Place Details fetch. Used by the enrich pipeline to (1) get
 * a venue's canonical website so the AI extractor starts from the right page, (2) gate
 * out non-alcohol-serving venues before any AI spend, and (3) grab a price tier + hero
 * photo for the listing. Field-masked to what we use.
 *
 * Returns null on any error (caller decides how to proceed). Requires
 * GOOGLE_PLACES_API_KEY.
 */
const ENDPOINT = "https://places.googleapis.com/v1/places/";

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
  try {
    const res = await fetch(`${ENDPOINT}${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "websiteUri,nationalPhoneNumber,priceLevel,primaryType," +
          "servesBeer,servesWine,servesCocktails,photos",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
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
