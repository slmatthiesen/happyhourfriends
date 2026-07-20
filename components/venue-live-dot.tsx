"use client";

import { useEffect, useState } from "react";
import { NowBadge } from "@/components/now-badge";
import { formatTime } from "@/lib/format";
import {
  isWindowActive,
  nextWindowStart,
  venueLocalNow,
  type HappyHourWindow,
  type OpenPeriod,
} from "@/lib/geo/timezone";

const DAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/**
 * Live state for the venue-page "Happy hours" heading — the same signal the city grid
 * shows, in-context on the venue. When a window is open: pulsing dot + "Live now". When
 * not: a quiet dot + when the next window starts ("Starts tomorrow at 4 PM"), so the
 * highest-intent question — is it on, and if not when — is answered on the page instead of
 * left to the reader to work out from the day/time rows.
 *
 * Computed CLIENT-SIDE in the venue's local tz so the ISR-cached page never serves a stale
 * clock state (the page has no server-side time logic by design); re-checks each minute.
 * Renders nothing until mounted, or when not live and no next start is resolvable.
 */
type LiveState =
  | { kind: "live" }
  | { kind: "next"; label: string }
  | { kind: "none" };

export function VenueLiveDot({
  happyHours,
  hoursJson,
  timezone,
}: {
  happyHours: HappyHourWindow[];
  hoursJson: OpenPeriod[] | null;
  timezone: string | null;
}) {
  const [state, setState] = useState<LiveState>({ kind: "none" });

  useEffect(() => {
    if (!timezone) return;
    const check = () => {
      const now = venueLocalNow(timezone, new Date());
      if (happyHours.some((h) => isWindowActive(h, now, hoursJson))) {
        setState({ kind: "live" });
        return;
      }
      const next = nextWindowStart(happyHours, now, hoursJson);
      if (!next) {
        setState({ kind: "none" });
        return;
      }
      const when =
        next.dayOffset === 0
          ? "today"
          : next.dayOffset === 1
            ? "tomorrow"
            : DAY_NAMES[next.isoDay];
      setState({ kind: "next", label: `Starts ${when} at ${formatTime(next.startTime)}` });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [happyHours, hoursJson, timezone]);

  if (state.kind === "live") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <NowBadge open />
        <span className="text-sm font-medium text-accent-warm">Live now</span>
      </span>
    );
  }
  if (state.kind === "next") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <NowBadge open={false} />
        <span className="text-sm text-text-muted">{state.label}</span>
      </span>
    );
  }
  return null;
}
