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
        "inline-block text-sm font-medium text-text-muted transition-colors hover:text-text-primary",
        className,
      )}
      style={{ fontFamily: "var(--font-serif)" }}
    >
      Happy Hour Friends
    </Link>
  );
}
