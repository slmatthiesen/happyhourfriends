import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/* Same clinking-glasses mark as app/icon.svg, rendered as PNG for Apple
   (apple-touch-icon must be opaque PNG; iOS applies its own corner mask). */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#1a1530",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 100 100">
          <g transform="rotate(14 34.5 52)">
            <path
              d="M25 34 h19 l-3.5 36 h-12 Z"
              fill="none"
              stroke="#e8a04b"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <path d="M28 48 h13.5 l-2 18.5 h-9.5 Z" fill="#e8a04b" />
          </g>
          <g transform="rotate(-14 65.5 52)">
            <path
              d="M56 34 h19 l-3.5 36 h-12 Z"
              fill="none"
              stroke="#e8a04b"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <path d="M58.5 48 h13.5 l-2 18.5 h-9.5 Z" fill="#e8a04b" />
          </g>
          <g stroke="#f4ebe0" strokeWidth="3.5" strokeLinecap="round">
            <path d="M50 28 V20" />
            <path d="M44 29 L39 24" />
            <path d="M56 29 L61 24" />
          </g>
        </svg>
      </div>
    ),
    { ...size },
  );
}
