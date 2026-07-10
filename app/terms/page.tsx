import type { Metadata } from "next";
import Link from "next/link";
import { SiteWordmark } from "@/components/site-wordmark";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service · Happy Hour Friends",
  description:
    "The terms for using Happy Hour Friends, including limits on automated scraping and redistribution of our data.",
  alternates: { canonical: "/terms" },
};

// Operator-confirm before launch: contact email and the "last updated" date. The data
// here (every venue, every happy hour) is first-party and expensive to collect — the
// prohibited-use and ownership sections are the load-bearing anti-cloning language.
const CONTACT_EMAIL = "hello@happyhourfriends.com";
const LAST_UPDATED = "June 23, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <SiteWordmark className="mb-8" />
      <h1
        className="text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Terms of Service
      </h1>
      <p className="mt-3 text-sm text-text-muted">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 space-y-8 text-text-muted">
        <section className="space-y-3">
          <p>
            Welcome to Happy Hour Friends (&ldquo;Happy Hour Friends,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us&rdquo;). By accessing or using this website
            (the &ldquo;Service&rdquo;), you agree to these Terms of Service. If you
            don&apos;t agree, please don&apos;t use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">
            1. Permitted use
          </h2>
          <p>
            You may browse the Service and use its information for your own personal,
            non-commercial purposes — finding a happy hour, sharing a link with a
            friend, submitting a correction. That&apos;s what it&apos;s here for.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">
            2. Prohibited use
          </h2>
          <p>You agree that you will not, and will not help anyone else:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Access, scrape, crawl, harvest, or copy the Service or its data using any
              automated means — bots, spiders, scrapers, headless browsers, or
              extraction scripts — except for the operators of well-behaved search
              engines indexing the site for public search, and only as permitted by our{" "}
              <code className="text-text-primary">robots.txt</code>.
            </li>
            <li>
              Copy, reproduce, republish, redistribute, sell, license, or create a
              derivative or competing database, directory, or product from the
              Service&apos;s content, in whole or in substantial part.
            </li>
            <li>
              Circumvent, disable, or interfere with rate limiting, bot detection, or
              any other security or access-control measure.
            </li>
            <li>
              Place an unreasonable load on our infrastructure, or access the Service in
              a way that degrades it for others.
            </li>
            <li>
              Misrepresent the origin of the data or remove, obscure, or alter any
              attribution, branding, or notices.
            </li>
          </ul>
          <p>
            We invest significant time and money to collect, verify, and maintain this
            data first-hand. Bulk extraction and re-publication of it is not permitted.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">
            3. Ownership of the data
          </h2>
          <p>
            The Service, its compilation of happy-hour listings, and the selection,
            arrangement, and verification of that data are owned by Happy Hour Friends
            and protected by intellectual-property and database rights. Individual facts
            may be public, but our curated, verified compilation of them is ours. These
            Terms grant you no ownership and no license beyond the personal,
            non-commercial use described in Section 1.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">
            4. Submissions
          </h2>
          <p>
            When you submit a venue, correction, or other content, you grant us a
            worldwide, royalty-free, perpetual license to use, modify, publish, and
            display it as part of the Service. You confirm you have the right to share
            it and that it&apos;s accurate to the best of your knowledge. Don&apos;t
            submit data copied from other happy-hour aggregators or paid directories.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">
            5. No warranty
          </h2>
          <p>
            We work hard to keep listings accurate, but happy hours change. The Service
            is provided &ldquo;as is,&rdquo; without warranties of any kind. Always
            confirm details with the venue before you go. To the fullest extent
            permitted by law, we are not liable for any loss arising from your use of —
            or reliance on — the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">
            6. Changes &amp; enforcement
          </h2>
          <p>
            We may update these Terms from time to time; continued use after a change
            means you accept the new Terms. We may suspend or block access — including by
            IP address or network — for anyone who violates them, and we reserve all
            legal remedies for misuse, including unauthorized scraping or copying.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">
            7. Governing law
          </h2>
          <p>
            These Terms are governed by the laws of the State of California, without
            regard to its conflict-of-laws rules.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-text-primary">8. Contact</h2>
          <p>
            Questions about these Terms? Reach us at{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-accent-cool hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <p className="pt-2 text-sm">
          See also our{" "}
          <Link href="/about" className="text-accent-cool hover:underline">
            About
          </Link>{" "}
          page for how we collect and verify this data.
        </p>
      </div>

      <SiteFooter className="mt-16 border-t border-border pt-10" />
    </main>
  );
}
