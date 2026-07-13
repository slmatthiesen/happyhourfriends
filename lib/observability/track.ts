/**
 * Structured client-side event capture. No-op (and no posthog-js download) when
 * NEXT_PUBLIC_POSTHOG_KEY is unset, mirroring PostHogProvider's opt-in guard.
 * posthog-js is a singleton: once the provider calls init(), this dynamic import
 * resolves to the same initialized instance. The key is inlined into the client
 * bundle by Next at build time, so the guard runs without a network round-trip.
 */
export type OutboundLinkType = "map" | "website" | "social_menu" | "source";

export interface OutboundLinkEvent {
  link_type: OutboundLinkType;
  destination_url?: string;
  venue_id?: string;
  venue_slug?: string;
  venue_name?: string;
  city_slug?: string;
  state_slug?: string;
  source_kind?: string;
}

export function captureOutbound(event: OutboundLinkEvent): void {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.capture("outbound_link_clicked", event);
  });
}
