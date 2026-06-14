import type { Metadata } from "next";
import Image from "next/image";
import { SiteWordmark } from "@/components/site-wordmark";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "About · Happy Hour Friends",
  description: "How Happy Hour Friends collects and verifies happy hour data.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <SiteWordmark className="mb-8" />
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
        <p>
          We do our best to source this data — but the freshest, most up-to-date info
          often lives in the bar itself, on the menu or a placard by the door. If you
          spot something current that we&apos;re missing, we&apos;d love to hear it. A
          quick heads-up helps you and your neighbors.
        </p>
      </div>
      <section className="mt-14 border-t border-border pt-10">
        <h2
          className="text-2xl font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Hey — I&apos;m Steven 👋
        </h2>
        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
          <Image
            src="/about/me.jpg"
            alt="Steven in a sombrero, having a great time"
            width={160}
            height={160}
            className="h-40 w-40 shrink-0 rounded-xl object-cover"
          />
          <div className="space-y-4 text-text-muted">
            <p>
              About ten years ago I built a site a lot like this one, just for
              Phoenix. No ads, no gimmicks — every happy hour in town in one big
              list. It started as the way my friends and I kept track of where
              to eat and drink for cheap, so we were all working from the same
              list. People loved it, and I never stopped thinking about why:
              nobody wants to dig through ten menus to find deals on tacos, happening right now, nearby.
              Friends just tell each other.
            </p>
            <p>
              That&apos;s the bet behind Happy Hour Friends: a community that
              keeps each other in the loop will always find better deals than
              any ad budget. The data starts with us, but it gets good with you
              — if you spot a deal we&apos;re missing or a price that&apos;s
              changed, send it in. That&apos;s the whole idea.
            </p>
            <p>Thanks for reading — hope to catch you at a spot.</p>
          </div>
        </div>
      </section>
      <SiteFooter className="mt-14 border-t border-border pt-8" />
    </main>
  );
}
