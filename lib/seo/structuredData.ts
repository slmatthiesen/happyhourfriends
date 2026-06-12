/**
 * Shared helpers for JSON-LD structured data. Centralizes the absolute-URL base so
 * canonical/OG/sitemap and on-page JSON-LD all agree on one origin.
 */

/** Absolute origin for structured-data URLs. Baked in at build time (NEXT_PUBLIC_). */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** A single breadcrumb: a display name + an absolute-or-relative site path. */
export interface Crumb {
  name: string;
  /** Site-relative path beginning with "/" (e.g. "/wa/tacoma"). */
  path: string;
}

/**
 * schema.org BreadcrumbList. Positions are 1-based; `item` is the absolute URL.
 * Google renders these as the breadcrumb trail in search results.
 */
/** schema.org WebSite — site-name entity for the home page. */
export function webSiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Happy Hour Friends",
    url: SITE_URL,
  };
}

export function breadcrumbListLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path}`,
    })),
  };
}
