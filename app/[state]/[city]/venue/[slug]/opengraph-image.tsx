import { ImageResponse } from "next/og";
import { getCityByPath, getVenueBySlug } from "@/lib/queries/venues";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Happy Hour Friends";

export default async function Image({
  params,
}: {
  params: Promise<{ state: string; city: string; slug: string }>;
}) {
  const { state, city: citySlug, slug } = await params;

  const city = await getCityByPath(state, citySlug).catch(() => null);
  const venue = city
    ? await getVenueBySlug(city.id, slug).catch(() => null)
    : null;

  // Generic branded fallback when venue/city not found
  if (!venue || !city) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "flex-end",
            backgroundColor: "#1a1530",
            padding: "64px 72px",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 80,
              height: 6,
              backgroundColor: "#e8a04b",
              borderRadius: 3,
              marginBottom: 32,
            }}
          />
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: "#f4ebe0",
              fontFamily: "Georgia, serif",
              lineHeight: 1.1,
            }}
          >
            Happy Hour Friends
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              color: "#a89bc4",
              fontFamily: "system-ui, sans-serif",
              marginTop: 16,
            }}
          >
            Find happy hours near you
          </div>
        </div>
      ),
      { ...size },
    );
  }

  const subtitle = [venue.neighborhoodName, venue.address]
    .filter(Boolean)
    .join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          backgroundColor: "#1a1530",
          padding: "64px 72px",
        }}
      >
        {/* Decorative accent bar */}
        <div
          style={{
            display: "flex",
            width: 80,
            height: 6,
            backgroundColor: "#e8a04b",
            borderRadius: 3,
            marginBottom: 32,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Venue name */}
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: "#e8a04b",
              fontFamily: "Georgia, serif",
              lineHeight: 1.05,
            }}
          >
            {venue.name}
          </div>
          {/* Neighborhood / address */}
          {subtitle ? (
            <div
              style={{
                display: "flex",
                fontSize: 30,
                color: "#a89bc4",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {subtitle}
            </div>
          ) : null}
          {/* Wordmark */}
          <div
            style={{
              display: "flex",
              fontSize: 26,
              color: "#f4ebe0",
              fontFamily: "system-ui, sans-serif",
              marginTop: 8,
              opacity: 0.7,
            }}
          >
            Happy Hour Friends · {city.name}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
