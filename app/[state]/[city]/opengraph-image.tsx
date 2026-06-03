import { ImageResponse } from "next/og";
import { getCityByPath } from "@/lib/queries/venues";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Happy Hour Friends";

export default async function Image({
  params,
}: {
  params: Promise<{ state: string; city: string }>;
}) {
  const { state, city: citySlug } = await params;
  const city = await getCityByPath(state, citySlug).catch(() => null);
  const cityName = city?.name ?? citySlug.charAt(0).toUpperCase() + citySlug.slice(1);

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
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              color: "#f4ebe0",
              lineHeight: 1.1,
              fontFamily: "Georgia, serif",
            }}
          >
            {cityName} Happy Hours
          </div>
          <div
            style={{
              fontSize: 32,
              color: "#a89bc4",
              fontFamily: "system-ui, sans-serif",
              fontWeight: 400,
            }}
          >
            Happy Hour Friends
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
