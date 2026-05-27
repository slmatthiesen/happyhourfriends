import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About · Happy Hour Friends",
  description: "How Happy Hour Friends collects and verifies happy hour data.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1
        className="text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        About
      </h1>
      <div className="mt-6 space-y-4 text-text-muted">
        <p>
          Happy Hour Friends puts every happy hour in your city into one sortable,
          filterable table — sort by start time, end time, or price; filter by
          neighborhood, food, drink, and vibe.
        </p>
        <p>
          <strong className="text-text-primary">We&apos;d rather show nothing
          than guess.</strong>{" "}
          Every detail in the live data traces to a verifiable source. Where we
          don&apos;t have confirmed info, you&apos;ll see a &ldquo;help us fill this
          in&rdquo; prompt instead of a guess.
        </p>
        <p>
          Anyone can submit a correction or a new venue — no account needed. An AI
          moderation pipeline reviews every submission, checks plausible changes
          against the venue&apos;s own website and social channels, applies low-risk
          verified changes automatically, and routes anything risky to a human.
        </p>
      </div>
    </main>
  );
}
