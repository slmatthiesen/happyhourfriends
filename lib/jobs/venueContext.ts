import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions, happyHours, offerings, venues } from "@/db/schema";
import type { SubmissionDiff } from "@/lib/apply/types";

/** The minimum slice of an edit_submissions row needed to resolve its venue. */
export type SubmissionLike = Pick<
  typeof editSubmissions.$inferSelect,
  "targetType" | "targetId" | "diffJsonb"
>;

export interface VenueContext {
  name: string;
  websiteUrl: string | null;
  otherUrl: string | null;
  cityId?: string;
}

/**
 * Resolve the venue behind a submission (verifier context + operator emails).
 * Shared by the verify handler and queue-for-review notifications.
 */
export async function venueContext(sub: SubmissionLike): Promise<VenueContext | null> {
  const diff = sub.diffJsonb as SubmissionDiff;
  if (sub.targetType === "new_venue") {
    return {
      name: String(diff.after?.name ?? "Unknown venue"),
      websiteUrl: (diff.after?.websiteUrl as string | undefined) ?? null,
      otherUrl: (diff.after?.otherUrl as string | undefined) ?? null,
      cityId: diff.after?.cityId as string | undefined,
    };
  }

  let venueId: string | null = null;
  if (
    sub.targetType === "venue" ||
    sub.targetType === "intent" ||
    sub.targetType === "new_happy_hour"
  ) {
    // intent reports and first-happy-hour submissions target the venue directly.
    venueId = sub.targetId;
  } else if (sub.targetType === "happy_hour" && sub.targetId) {
    const [h] = await db
      .select({ venueId: happyHours.venueId })
      .from(happyHours)
      .where(eq(happyHours.id, sub.targetId))
      .limit(1);
    venueId = h?.venueId ?? null;
  } else if (sub.targetType === "offering" && sub.targetId) {
    const [o] = await db
      .select({ happyHourId: offerings.happyHourId })
      .from(offerings)
      .where(eq(offerings.id, sub.targetId))
      .limit(1);
    if (o) {
      const [h] = await db
        .select({ venueId: happyHours.venueId })
        .from(happyHours)
        .where(eq(happyHours.id, o.happyHourId))
        .limit(1);
      venueId = h?.venueId ?? null;
    }
  } else if (sub.targetType === "new_offering") {
    // A new offering carries its parent happy hour's id in the diff (no row yet).
    const hhId = diff.after?.happyHourId as string | undefined;
    if (hhId) {
      const [h] = await db
        .select({ venueId: happyHours.venueId })
        .from(happyHours)
        .where(eq(happyHours.id, hhId))
        .limit(1);
      venueId = h?.venueId ?? null;
    }
  }
  if (!venueId) return null;

  const [v] = await db
    .select({
      name: venues.name,
      websiteUrl: venues.websiteUrl,
      otherUrl: venues.otherUrl,
      cityId: venues.cityId,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  return v
    ? { name: v.name, websiteUrl: v.websiteUrl, otherUrl: v.otherUrl, cityId: v.cityId }
    : null;
}
