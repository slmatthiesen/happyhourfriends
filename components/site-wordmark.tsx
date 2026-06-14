import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Small brand link back to the landing page. Sits at the top of the city /
 * neighborhood / venue pages so visitors always have a way home.
 */
export function SiteWordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-block text-sm font-medium text-text-muted underline-offset-4 transition-colors hover:text-text-primary hover:underline",
        className,
      )}
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <span aria-hidden="true">🍻</span>&nbsp;Happy Hour Friends
    </Link>
  );
}
