import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Happy Hour Friends",
    short_name: "Happy Hour Friends",
    description:
      "Every happy hour in your city, in one sortable table. No guesses — every detail traces to a source.",
    start_url: "/",
    display: "browser",
    background_color: "#1a1530",
    theme_color: "#1a1530",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
