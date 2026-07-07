import type { Metadata } from "next";
import { CityPicker } from "@/components/city-picker";
import { SiteFooter } from "@/components/site-footer";
import { listCities } from "@/lib/queries/venues";
import { webSiteLd } from "@/lib/seo/structuredData";

// Rendered per-request, not prerendered at build: the city list comes from the DB,
// so building this page statically would couple `next build` to a reachable DB.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Happy Hour Friends — the simplest way to find happy hour near you",
  description:
    "Find happy hours near you — sortable by time, day, and deal, every deal sourced and kept fresh. No fluff, just the data.",
};

export default async function Home() {
  const cities = await listCities();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-20 text-center sm:py-28">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteLd()) }}
      />
      <h1
        className="text-balance text-4xl font-semibold text-text-primary sm:text-5xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        The simplest way to find happy hour near you.
      </h1>

      <p className="mt-6 max-w-xl text-balance text-lg text-text-muted">
        Just the data you want. Sort it, filter it, find your spot. Snap a pic
        to add a spot or fix a deal — we keep each other in the loop.
      </p>
      <p className="mt-3 text-lg font-medium text-text-primary">
        Find your spot:
      </p>

      {cities.length > 0 ? (
        <CityPicker cities={cities} />
      ) : (
        <p className="mt-10 text-text-muted">
          No cities are live yet — check back soon.
        </p>
      )}

      <p className="mt-16 text-center text-sm text-text-muted/80">
        Built by a friend who loves trying new places.
      </p>
      <SiteFooter className="mt-4" />
    </main>
  );
}
