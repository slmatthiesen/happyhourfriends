import type { Metadata } from "next";
import Link from "next/link";
import { CityPicker } from "@/components/city-picker";
import { listCities } from "@/lib/queries/venues";

export const metadata: Metadata = {
  title: "Happy Hour Friends — every happy hour, none of the fluff",
  description:
    "The simplest happy hour site around. Just the data you want: sort it, filter it, find your spot. And when something's off, fix it — we all help each other out here.",
};

export default async function Home() {
  const cities = await listCities();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-20 text-center sm:py-28">
      <h1
        className="text-balance text-4xl font-semibold text-text-primary sm:text-5xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        The simplest happy hour site around.
      </h1>

      <p className="mt-6 max-w-xl text-balance text-lg text-text-muted">
        Just the data you want — none of the fluff, no extra pages. Sort it,
        filter it, find your spot. And when something&apos;s off, fix it.
      </p>
      <p className="mt-3 text-lg font-medium text-text-primary">
        Come in, find a place to eat and drink.
      </p>

      {cities.length > 0 ? (
        <CityPicker cities={cities} />
      ) : (
        <p className="mt-10 text-text-muted">
          No cities are live yet — check back soon.
        </p>
      )}

      <footer className="mt-16 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-text-muted">
        <Link href="/about" className="hover:text-text-primary">
          About
        </Link>
        <Link href="/faq" className="hover:text-text-primary">
          FAQ
        </Link>
        <Link href="/for-restaurants" className="hover:text-text-primary">
          For restaurants
        </Link>
      </footer>
    </main>
  );
}
