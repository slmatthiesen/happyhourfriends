import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmissionForm, type FieldSpec } from "@/components/submit/submission-form";
import { venueType } from "@/db/schema";
import { getCityBySlug } from "@/lib/queries/venues";

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
  const city = await getCityBySlug(citySlug);
  if (!city) notFound();

  const fields: FieldSpec[] = [
    { key: "name", label: "Venue name", placeholder: "e.g. The Office Bar & Grill" },
    { key: "address", label: "Address", placeholder: "Street, city, state" },
    { key: "websiteUrl", label: "Website", type: "url", placeholder: "https://" },
    {
      key: "otherUrl",
      label: "Other link (Facebook, Instagram…)",
      type: "url",
      placeholder: "https://",
    },
    { key: "phone", label: "Phone", placeholder: "(253) 555-0100" },
    { key: "type", label: "Type", type: "select", options: TYPE_OPTIONS },
  ];

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12">
      <Link href={`/${city.slug}`} className="text-sm text-accent-cool hover:underline">
        ← All {city.name}
      </Link>
      <h1
        className="mt-3 text-3xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Add a {city.name} venue
      </h1>
      <p className="mt-2 text-text-muted">
        Tell us about a spot we&apos;re missing. We never publish happy-hour details
        without a source, so add a link if you have one — otherwise we&apos;ll verify
        it ourselves.
      </p>

      <div className="mt-8">
        <SubmissionForm
          targetType="new_venue"
          newRecord
          fixedAfter={{ cityId: city.id, status: "active" }}
          fields={fields}
          summary="New venue submission"
          submitLabel="Submit venue"
        />
      </div>
    </main>
  );
}
