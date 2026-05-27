import type { Metadata } from "next";
import { Fraunces, Inter, Geist } from "next/font/google";
import { PostHogProvider } from "@/lib/observability/posthog-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";
import "./globals.css";
import { cn } from "@/lib/utils";

// Applies the saved palette before first paint (no flash). Mirrors ThemeSwitcher.
const THEME_INIT = `try{var t=localStorage.getItem('hhf_theme');if(t&&t!=='twilight')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
      className={cn("h-full", "antialiased", fraunces.variable, inter.variable, "font-sans", geist.variable)}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PostHogProvider>{children}</PostHogProvider>
        <ThemeSwitcher />
      </body>
    </html>
  );
}
