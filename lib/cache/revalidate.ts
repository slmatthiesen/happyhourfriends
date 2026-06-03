import "server-only";
import { cityPath, neighborhoodPath, venuePath } from "@/lib/routes";

/**
 * On-demand cache invalidation for the public read pages.
 *
 * The landing counts (`unstable_cache` tag `cities-summary`) and the city /
 * neighborhood / venue pages (full-route ISR) are server-side cached and shared across
 * all visitors. When the AI auto-applies a change or an admin applies/reverts one, we
 * want those pages to refresh immediately rather than waiting out the time-based window.
 *
 * The catch: `revalidatePath` / `revalidateTag` only work inside a Server Action or a
 * Route Handler — NOT arbitrary server code. The apply engine runs in BOTH an admin
 * Server Action (manual) and a pg-boss worker (AI auto-apply), and the worker has no
 * request context. So instead of calling the Next APIs directly from the engine, we
 * POST to an internal Route Handler (`/api/internal/revalidate`) that performs the
 * invalidation in a valid context. One code path covers both callers.
 *
 * This is best-effort: a revalidation failure must never break or delay a write, so all
 * errors are swallowed (the time-based window is the backstop).
 */

export interface VenueRevalidationTarget {
  stateSlug: string;
  citySlug: string;
  venueSlug?: string | null;
  neighborhoodSlug?: string | null;
  /** True when the change can move a venue between "has hours" and "stub" — i.e. it
   *  affects the landing-page counts (venue add/remove, happy-hour add/remove). */
  countsChanged?: boolean;
}

/** Translate a venue change into the concrete paths + cache tags to invalidate. */
export function venueRevalidationItems(t: VenueRevalidationTarget): {
  paths: string[];
  tags: string[];
} {
  const paths = [cityPath(t.stateSlug, t.citySlug)];
  if (t.venueSlug) paths.push(venuePath(t.stateSlug, t.citySlug, t.venueSlug));
  if (t.neighborhoodSlug)
    paths.push(neighborhoodPath(t.stateSlug, t.citySlug, t.neighborhoodSlug));
  const tags = t.countsChanged ? ["cities-summary"] : [];
  return { paths, tags };
}

/** Local server origin — target the Next process directly rather than the public
 *  domain, so we never depend on the box resolving its own hostname through the proxy. */
function internalBaseUrl(): string {
  return (
    process.env.INTERNAL_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "3000"}`
  );
}

/**
 * Fire the internal revalidation request. Safe to call from any server context
 * (Server Action, Route Handler, or pg-boss worker). Never throws.
 */
export async function requestVenueRevalidation(
  target: VenueRevalidationTarget,
): Promise<void> {
  const { paths, tags } = venueRevalidationItems(target);
  if (paths.length === 0 && tags.length === 0) return;
  const secret = process.env.REVALIDATE_SECRET;
  try {
    const res = await fetch(`${internalBaseUrl()}/api/internal/revalidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-revalidate-secret": secret } : {}),
      },
      body: JSON.stringify({ paths, tags }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(
        `[revalidate] internal endpoint responded ${res.status} for ${paths.join(", ")}`,
      );
    }
  } catch (err) {
    console.warn("[revalidate] failed to trigger revalidation", err);
  }
}
