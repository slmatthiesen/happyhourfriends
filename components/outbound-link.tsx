"use client";

import { captureOutbound, type OutboundLinkEvent } from "@/lib/observability/track";

/**
 * Drop-in <a> that records a structured `outbound_link_clicked` event before
 * handing off to the browser. All outbound links open in a new tab, so the
 * current page survives the click and the async capture always flushes. Fires on
 * primary click and on aux/middle click (open-in-new-tab) so modifier-clicks
 * are counted too.
 */
type OutboundLinkProps = OutboundLinkEvent &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "onClick" | "onAuxClick">;

export function OutboundLink({
  link_type,
  destination_url,
  venue_id,
  venue_slug,
  venue_name,
  city_slug,
  state_slug,
  source_kind,
  children,
  ...anchorProps
}: OutboundLinkProps) {
  const track = () =>
    captureOutbound({
      link_type,
      destination_url: destination_url ?? anchorProps.href,
      venue_id,
      venue_slug,
      venue_name,
      city_slug,
      state_slug,
      source_kind,
    });
  return (
    <a {...anchorProps} onClick={track} onAuxClick={track}>
      {children}
    </a>
  );
}
