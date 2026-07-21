import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Brand link back to the landing page. Sits at the top of the city /
 * neighborhood / venue / static pages so visitors always have a way home.
 * Defaults to the header treatment (text-base/semibold/primary); callers pass
 * only layout classes (margins) — a page wanting a different size overrides here.
 */
export function SiteWordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-block text-base font-semibold text-text-primary underline-offset-4 transition-colors hover:underline",
        className,
      )}
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <span aria-hidden="true">🍻</span>&nbsp;Happy Hour Friends
    </Link>
  );
}
