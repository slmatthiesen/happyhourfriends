"use client";

import { useEffect, useState } from "react";
import { NowBadge } from "@/components/now-badge";
import {
  isWindowActive,
  venueLocalNow,
  type HappyHourWindow,
  type OpenPeriod,
} from "@/lib/geo/timezone";

/**
 * Live "happening now" dot for the venue page heading — the same signal the city grid
 * shows, in-context on the venue itself. Computed CLIENT-SIDE in the venue's local tz so
 * the ISR-cached page never serves a stale clock state (the page has no server-side time
 * logic by design). Renders nothing unless a window is currently active; re-checks each
 * minute so it lights up / clears as the window opens and closes.
 */
export function VenueLiveDot({
  happyHours,
  hoursJson,
  timezone,
}: {
  happyHours: HappyHourWindow[];
  hoursJson: OpenPeriod[] | null;
  timezone: string | null;
}) {
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!timezone) return;
    const check = () => {
      const now = venueLocalNow(timezone, new Date());
      setLive(happyHours.some((h) => isWindowActive(h, now, hoursJson)));
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [happyHours, hoursJson, timezone]);

  if (!live) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <NowBadge open />
      <span className="text-sm font-medium text-accent-warm">Live now</span>
    </span>
  );
}
