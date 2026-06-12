import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { PostHogProvider } from "@/lib/observability/posthog-provider";
import { uiFlags } from "@/lib/ui/flags";
import { FloatingDoodles } from "@/components/ui/floating-doodles";
import "./globals.css";
import { cn } from "@/lib/utils";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

// Absolute base for every canonical/OG URL. Without it, `alternates.canonical` and the
// route-level opengraph-image URLs resolve against the request host, which is brittle
// behind the proxy and yields inconsistent canonicals. Falls back to localhost so
// `next build` (which evaluates metadata) never throws on a missing env.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Happy Hour Friends",
  description:
    "Every happy hour in your city, in one sortable table. No guesses — every detail traces to a source.",
  applicationName: "Happy Hour Friends",
  // Text-only OG defaults — social/OG images are deliberately out of scope for now
  // (no venue imagery available; operator decision 2026-06-11).
  openGraph: {
    siteName: "Happy Hour Friends",
    type: "website",
    locale: "en_US",
    url: "/",
    title: "Happy Hour Friends",
    description:
      "Every happy hour in your city, in one sortable table. No guesses — every detail traces to a source.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", "font-sans", jakarta.variable)}
    >
      <body className={cn("min-h-full flex flex-col", uiFlags.aurora && "aurora-on")}>
        <FloatingDoodles />
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
