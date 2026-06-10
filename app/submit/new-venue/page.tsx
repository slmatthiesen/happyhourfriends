import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmissionForm, type FieldSpec } from "@/components/submit/submission-form";
import { venueType } from "@/db/schema";
import { getCityBySlugAny } from "@/lib/queries/venues";
import { cityPath } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Add a venue · Happy Hour Friends",
  description: "Know a happy hour we're missing? Add the venue and we'll verify it.",
};

const TYPE_OPTIONS = venueType.enumValues.map((v) => ({
  value: v,
  label: v.replace(/_/g, " "),
}));

export default async function NewVenuePage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city: citySlug = "tacoma" } = await searchParams;
  const city = await getCityBySlugAny(citySlug);
  if (!city) notFound();

  const fields: FieldSpec[] = [
    {
      key: "name",
      label: "Venue name",
      placeholder: "e.g. The Office Bar & Grill",
      required: true,
    },
    {
      key: "address",
      label: "Street address",
      placeholder: "e.g. 1102 A St",
      help: `City & state are added automatically (${city.name}, ${city.state}).`,
      required: true,
    },
    {
      key: "websiteUrl",
      label: "Website",
      type: "url",
      placeholder: "e.g. theofficebar.com",
      required: true,
    },
    { key: "type", label: "Type", type: "select", options: TYPE_OPTIONS },
  ];

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12">
      <Link href={cityPath(city.state, city.slug)} className="text-sm text-accent-cool hover:underline">
        ← All {city.name}
      </Link>
      <h1
        className="mt-3 text-3xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Add a {city.name} venue
      </h1>
      <p className="mt-2 text-text-muted">
        Tell us about a spot we&apos;re missing — just the name, street address, and
        website. We&apos;ll pull the happy-hour details from there and verify them
        before anything goes live.
      </p>

      <div className="mt-8">
        <SubmissionForm
          targetType="new_venue"
          newRecord
          fixedAfter={{ cityId: city.id, status: "active" }}
          fields={fields}
          addressSuffix={`${city.name}, ${city.state}`}
          summary="New venue submission"
          submitLabel="Submit venue"
        />
      </div>
    </main>
  );
}
