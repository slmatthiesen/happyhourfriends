import type { Metadata } from "next";
import { SiteWordmark } from "@/components/site-wordmark";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "For Restaurants · Happy Hour Friends",
  description:
    "Own or manage a bar or restaurant listed on Happy Hour Friends? Learn how to keep your happy hour info accurate.",
};

export default function ForRestaurantsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <SiteWordmark className="mb-8" />
      <h1
        className="text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        For restaurants &amp; bars
      </h1>
      <div className="mt-6 space-y-4 text-text-muted">
        <p>
          Happy Hour Friends aggregates verified happy hour details so guests
          can find you — with no guessing. Every time, day, and price on this
          site traces back to a real source.
        </p>
        <p>
          <strong className="text-text-primary">Claiming and promotion
          features are coming soon.</strong>{" "}
          In the meantime, the fastest way to update your listing is the
          &ldquo;Suggest an edit&rdquo; link on your venue page. We review every
          submission and apply verified changes quickly — usually within a day.
        </p>
        <p>
          We never publish unverified data. If we can&apos;t confirm a detail,
          we leave it blank rather than guess. That commitment protects your
          guests and your reputation.
        </p>
      </div>
      <SiteFooter className="mt-14 border-t border-border pt-8" />
    </main>
  );
}
