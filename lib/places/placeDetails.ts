/**
 * Google Places API (New) Place Details fetch. Used by the enrich pipeline to get a
 * venue's canonical website (so the AI extractor starts from the right page, not a
 * guess), its phone, and a photo handle for the hero image. Field-masked to the
 * cheap-ish fields we actually use.
 *
 * Returns null on any error (caller proceeds without details). Requires
 * GOOGLE_PLACES_API_KEY.
 */
const ENDPOINT = "https://places.googleapis.com/v1/places/";

export interface PlaceDetails {
  websiteUri: string | null;
  phone: string | null;
  /** Photo resource name (e.g. "places/XXX/photos/YYY") for the Place Photo endpoint. */
  photoName: string | null;
}

export async function fetchPlaceDetails(
  apiKey: string,
  placeId: string,
): Promise<PlaceDetails | null> {
  try {
    const res = await fetch(`${ENDPOINT}${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "websiteUri,nationalPhoneNumber,photos.name",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      websiteUri?: string;
      nationalPhoneNumber?: string;
      photos?: { name?: string }[];
    };
    return {
      websiteUri: data.websiteUri ?? null,
      phone: data.nationalPhoneNumber ?? null,
      photoName: data.photos?.[0]?.name ?? null,
    };
  } catch {
    return null;
  }
}
