import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Shared footer nav. Reused on the landing page and the standalone content pages
 * (about / faq / for-restaurants) so every page has a way home and to its siblings.
 * Muted "ambient nav" style — deliberately NOT the warm in-content link accent.
 */
const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/for-restaurants", label: "For restaurants" },
  { href: "/terms", label: "Terms" },
];

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-text-muted",
        className,
      )}
    >
      {FOOTER_LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="hover:text-text-primary">
          {l.label}
        </Link>
      ))}
    </footer>
  );
}
