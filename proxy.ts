import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  clientIpFromHeaders,
  hitPageLimit,
  isAllowedCrawler,
  isPrefetchRequest,
} from "@/lib/trust/pageRateLimit";

/**
 * Next 16 "Proxy" (formerly Middleware). Per-IP rate limit on public PAGE reads to
 * raise the cost of bulk scraping — competitors cloning the table by pulling every
 * venue page get throttled; humans and search crawlers don't.
 *
 * Defense-in-depth, NOT the primary wall: Cloudflare in front of the origin is the
 * real gate (Verified Bots, edge rate-limit rules, hidden origin IP — see
 * docs/cloudflare-anti-scrape-setup.md). This proxy is the backstop that still works
 * if a request reaches the origin directly.
 *
 * Scope (see matcher): public content pages only. Excluded — /api/* (own limiters),
 * /admin (auth-gated), _next assets, and crawlable infra (sitemap/robots/llms/icons).
 */
export function proxy(request: NextRequest) {
  // Never throttle local development. A single dev page load fans out into many RSC /
  // prefetch sub-requests, all from 127.0.0.1, which blows the per-IP budget and self-429s
  // the operator out of their own site. This limiter is a prod origin backstop only.
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  // Never throttle legit search/social crawlers — SEO and link unfurls depend on it.
  if (isAllowedCrawler(request.headers.get("user-agent"))) {
    return NextResponse.next();
  }

  // Never throttle router prefetch subrequests. A single city page fans out into dozens
  // (one per venue <Link> entering the viewport); counting them self-429s a real user
  // mid-scroll. This is the prod analog of the dev-mode bypass above — the same fan-out
  // that "blows the per-IP budget" happens in every production browser, not just at
  // 127.0.0.1. A bulk scraper fetches documents/RSC and never emits this header.
  if (isPrefetchRequest(request.headers)) return NextResponse.next();

  const ip = clientIpFromHeaders(request.headers);
  // Fail open when we can't identify the client (no proxy headers) — better to serve a
  // page than to block a real user over a header quirk. Loopback (same-box request) is
  // never a scraper, so exempt it even in production.
  if (!ip || ip === "127.0.0.1" || ip === "::1") return NextResponse.next();

  const { limited, retryAfterSec } = hitPageLimit(`page:${ip}`);
  if (limited) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything EXCEPT API routes, admin, Next internals, and static/infra files.
  matcher: [
    "/((?!api|admin|_next/static|_next/image|sitemap.xml|robots.txt|llms.txt|manifest.webmanifest|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|woff2?)$).*)",
  ],
};
