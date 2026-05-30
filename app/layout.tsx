import type { Metadata } from "next";
import {
  Fraunces,
  Inter,
  Geist,
  Bricolage_Grotesque,
  Plus_Jakarta_Sans,
  Space_Grotesk,
  Manrope,
} from "next/font/google";
import { PostHogProvider } from "@/lib/observability/posthog-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { FontSwitcher } from "@/components/font-switcher";
import "./globals.css";
import { cn } from "@/lib/utils";

// Applies the saved palette + font before first paint (no flash).
const APPEARANCE_INIT = `try{var t=localStorage.getItem('hhf_theme');if(t&&t!=='warm')document.documentElement.setAttribute('data-theme',t);var f=localStorage.getItem('hhf_font');if(f&&f!=='inter')document.documentElement.setAttribute('data-font',f);}catch(e){}`;

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Happy Hour Friends",
  description:
    "Every happy hour in your city, in one sortable table. No guesses — every detail traces to a source.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        fraunces.variable,
        inter.variable,
        geist.variable,
        bricolage.variable,
        jakarta.variable,
        spaceGrotesk.variable,
        manrope.variable,
      )}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PostHogProvider>{children}</PostHogProvider>
        <FontSwitcher />
        <ThemeSwitcher />
      </body>
    </html>
  );
}
