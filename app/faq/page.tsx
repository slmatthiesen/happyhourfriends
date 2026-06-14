import type { Metadata } from "next";
import { SiteWordmark } from "@/components/site-wordmark";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "FAQ · Happy Hour Friends",
  description:
    "How submissions work, how we verify data, and how we prevent fake edits.",
};

const faqs = [
  {
    q: "How is this data collected?",
    a: "AI-assisted, with human review. We pull candidate venues from public sources and confirm happy-hour details against each venue's own website and social channels before anything goes live.",
  },
  {
    q: "How do I submit a change?",
    a: "A photo of the menu or a happy-hour sign is usually all we need. Snap it, add it on any venue (a source link helps but isn't required), pass the captcha, and submit. Most verified low-risk changes apply within about a day.",
  },
  {
    q: "How do you prevent fake submissions?",
    a: "A trust score per submitter, AI verification against the venue's own channels, and community corroboration. Big changes — like 'this place stopped doing happy hour' — need multiple confirmations or a human's sign-off, never one anonymous edit.",
  },
  {
    q: "I'm a restaurant — how do I correct my listing?",
    a: "For now, use the regular submission form. A verified-owner claiming flow is coming.",
  },
  {
    q: "Why is some data missing?",
    a: "We'd rather show nothing than guess. If we can't verify a venue's happy hour, we show a 'help us add it' prompt instead of inventing details.",
  },
];

// FAQPage structured data, built from the SAME `faqs` array rendered below so the
// markup always matches the visible content (Google's requirement for FAQ rich results).
const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FaqPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <SiteWordmark className="mb-8" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <h1
        className="text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        FAQ
      </h1>
      <dl className="mt-8 space-y-8">
        {faqs.map((f) => (
          <div key={f.q}>
            <dt className="text-lg font-medium text-text-primary">{f.q}</dt>
            <dd className="mt-2 text-text-muted">{f.a}</dd>
          </div>
        ))}
      </dl>
      <SiteFooter className="mt-14 border-t border-border pt-8" />
    </main>
  );
}
