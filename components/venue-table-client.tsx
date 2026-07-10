"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDays, formatPrice, formatWindow } from "@/lib/format";
import {
  isWindowActive,
  minutesUntilWindowEnd,
  resolveBoundsForDay,
  venueLocalNow,
  type VenueLocalNow,
} from "@/lib/geo/timezone";
import type { HappyHourRow, VenueListItem } from "@/lib/queries/venues";
import { NowBadge } from "@/components/now-badge";
import { labelForVenueType } from "@/lib/places/venueType";
import { haversineMiles, formatDistance } from "@/lib/geo/distance";
import { directionsUrl, isApplePlatform } from "@/lib/geo/mapsLink";
import { useGeolocation } from "@/lib/geo/useGeolocation";
import { consumeGeoIntent } from "@/lib/geo/geoIntent";
import { venuePath } from "@/lib/routes";

// ISO day labels; index 1=Mon … 7=Sun
const DAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};
const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

type SortKey = "now" | "distance" | "startTime" | "endTime" | "name" | "neighborhood" | "type" | "price";

function windowBounds(v: VenueListItem) {
  const allDay = v.happyHours.some((h) => h.allDay);
  const starts = v.happyHours
    .map((h) => h.startTime)
    .filter((s): s is string => s != null)
    .sort();
  const ends = v.happyHours
    .map((h) => h.endTime)
    .filter((e): e is string => e != null)
    .sort();
  return {
    days: formatDays(v.happyHours.flatMap((h) => h.daysOfWeek)),
    allDay,
    start: starts[0] ?? null,
    end: ends.length ? ends[ends.length - 1] : null,
  };
}

function displayBounds(
  v: VenueListItem,
  activeW: HappyHourRow | null,
  tzNow: VenueLocalNow | null,
): { allDay: boolean; startTime: string | null; endTime: string | null } {
  // Feature the live window, else a window that runs today — and resolve its open-ended
  // side to today's real clock times. A resolved concrete time therefore always means
  // "today". With nothing today (or unknown hours) fall back to the merged summary.
  const today = tzNow
    ? v.happyHours.find((h) => h.daysOfWeek.includes(tzNow.dayOfWeek))
    : undefined;
  const w = activeW ?? today ?? null;
  if (w && tzNow) {
    const resolved = resolveBoundsForDay(w, v.hoursJson, tzNow.dayOfWeek);
    if (resolved) {
      return { allDay: false, startTime: resolved.startTime, endTime: resolved.endTime };
    }
    return { allDay: w.allDay, startTime: w.startTime, endTime: w.endTime };
  }
  if (w) return { allDay: w.allDay, startTime: w.startTime, endTime: w.endTime };
  const b = windowBounds(v);
  return { allDay: b.allDay, startTime: b.start, endTime: b.end };
}

/**
 * $ / $$ / $$$ / $$$$ indicator. Prefers Google's venue price level (a sense of the
 * venue's general tier — what the operator wants surfaced); falls back to the cheapest
 * happy-hour offering price only when Google has no level.
 */
function priceTier(v: VenueListItem): string | null {
  if (v.priceLevel != null && v.priceLevel >= 1) return "$".repeat(v.priceLevel);
  const c = v.minPriceCents;
  if (c == null) return null;
  return c <= 800 ? "$" : c <= 1500 ? "$$" : "$$$";
}

function dealsPreview(v: VenueListItem): { text: string; extra: number } {
  const labels = v.offerings.map((o) => o.label);
  const shown = labels.slice(0, 2);
  return { text: shown.join(", "), extra: Math.max(0, labels.length - shown.length) };
}

/** Viewer's local ISO weekday (1=Mon..7=Sun). */
function localISODay(): number {
  const d = new Date().getDay(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
}

/** "Ends in 47 min" / "Ends in 1h 12m". Callers pass a positive integer. */
function formatRemaining(mins: number): string {
  if (mins <= 0) return "Ending now";
  if (mins < 60) return `Ends in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `Ends in ${h}h` : `Ends in ${h}h ${m}m`;
}

/**
 * Microcopy for the live badge naming WHAT is active. An all-day deal (e.g. a Taco
 * Tuesday) runs the whole day, so it has no "ends in" — instead we label it with its
 * note (or a plain "All day") so a venue doesn't read as "happy hour now" at 7pm just
 * because a day-specific all-day special is on. Timed windows keep the "ends in" copy.
 */
function activeDealLabel(w: HappyHourRow): string {
  const note = w.notes?.trim();
  if (!note) return "All day";
  return note.length > 28 ? `${note.slice(0, 27)}…` : note;
}

/**
 * Clickable distance label. Renders nothing if the venue has no coordinates.
 * The label opens turn-by-turn directions from the visitor (origin) to the venue
 * via the shared maps deep-link helper.
 */
function DistanceLink({
  origin,
  venue,
  isApple,
}: {
  origin: { lat: number; lng: number };
  venue: VenueListItem;
  isApple: boolean;
}): React.JSX.Element | null {
  if (venue.lat == null || venue.lng == null) return null;
  const dest = { lat: venue.lat, lng: venue.lng };
  const mi = haversineMiles(origin, dest);
  return (
    <a
      href={directionsUrl(dest, origin, isApple)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-cool hover:underline"
      title={`Directions to ${venue.name}`}
    >
      {formatDistance(mi)}
    </a>
  );
}

export function VenueTableClient({
  stateSlug,
  citySlug,
  cityName,
  cityTimezone,
  venues,
  showNeighborhood = true,
  lastUpdated = null,
}: {
  stateSlug: string;
  citySlug: string;
  cityName: string;
  cityTimezone: string;
  venues: VenueListItem[];
  showNeighborhood?: boolean;
  /** ISO timestamp of the most recently updated venue in scope; null when none. */
  lastUpdated?: string | null;
}): React.JSX.Element {
  // Filter state
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<Set<string>>(new Set());
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [happeningNow, setHappeningNow] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("now");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  // Stubs are folded into an opt-in disclosure (collapsed by default).
  const [showStubs, setShowStubs] = useState(false);
  // On phones the chip rows (Day/Area/Type/Tags) collapse behind a "Filters" toggle
  // so the sticky bar stays slim and the venue list keeps the viewport. md+ always
  // shows them; this state only matters below that breakpoint.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const geo = useGeolocation();
  // Carry over a "Use my location" click from the landing page: consume the one-shot
  // intent flag and auto-locate. Permission was granted there moments ago, so this
  // resolves silently instead of re-prompting.
  useEffect(() => {
    if (consumeGeoIntent()) geo.request(() => setSortKey("distance"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geo.request is a stable useCallback; the whole geo object changes per render
  }, [geo.request]);
  // Platform check reads navigator, so it's stable for the page's lifetime —
  // compute once rather than per distance link per render.
  const isApple = useMemo(() => isApplePlatform(), []);

  // Derived neighborhoods list. Only surface a neighborhood as a filter chip if at
  // least one of its venues has actual happy-hour data — neighborhoods that are
  // entirely stubs add noise without giving the filter anything useful to narrow to.
  const neighborhoods = useMemo(() => {
    const names = new Set<string>();
    for (const v of venues) {
      if (v.neighborhoodName && v.happyHours.length > 0) names.add(v.neighborhoodName);
    }
    return [...names].sort();
  }, [venues]);

  // Derived venue types + tags present in this dataset
  const types = useMemo(() => {
    const set = new Set<string>();
    for (const v of venues) if (v.type) set.add(v.type);
    return [...set].sort();
  }, [venues]);

  const tagList = useMemo(() => {
    const set = new Set<string>();
    for (const v of venues) for (const t of v.tags) set.add(t);
    return [...set].sort();
  }, [venues]);

  // Today's ISO day
  const todayISO = useMemo(() => localISODay(), []);

  // Gate all wall-clock-derived UI (live badges, row muting, clock, live count,
  // relevance sort) until after hydration. The server and the first client render
  // both run with `mounted === false`, so they emit identical, time-independent
  // markup — without this, each side calls `new Date()` and React reports a
  // hydration mismatch. We flip it on in a post-mount effect, then re-render live.
  const [mounted, setMounted] = useState(false);

  // Re-render every minute so the live badge, ends-in microcopy, and city clock
  // stay current without a page refresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Defer the flip into a timer rather than calling setState synchronously in
    // the effect body (the latter trips react-hooks/set-state-in-effect). A 0ms
    // delay flips it on the next tick, right after the first paint matches the
    // server.
    const warmup = setTimeout(() => setMounted(true), 0);
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      clearTimeout(warmup);
      clearInterval(id);
    };
  }, []);

  // Cache venueLocalNow per timezone — computed every tick so the live "Now" badge
  // and ends-in microcopy stay live. Includes the city tz so the header clock
  // shows even on a city with zero venues. Empty until mounted (see above) so the
  // first client render matches the server.
  const nowByTz = useMemo(() => {
    const map = new Map<string, ReturnType<typeof venueLocalNow>>();
    if (!mounted) return map;
    const now = new Date();
    if (cityTimezone && !map.has(cityTimezone)) {
      map.set(cityTimezone, venueLocalNow(cityTimezone, now));
    }
    for (const v of venues) {
      const tz = v.timezone;
      if (tz && !map.has(tz)) map.set(tz, venueLocalNow(tz, now));
    }
    return map;
    // `tick` participates so we recompute every minute; lint will note it as unused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, cityTimezone, tick, mounted]);

  const activeWindow = useCallback(
    (v: VenueListItem): HappyHourRow | null => {
      const tz = v.timezone;
      if (!tz) return null;
      const now = nowByTz.get(tz);
      if (!now) return null;
      return v.happyHours.find((h) => isWindowActive(h, now, v.hoursJson)) ?? null;
    },
    [nowByTz],
  );

  const isNowOpen = useCallback(
    (v: VenueListItem): boolean => activeWindow(v) != null,
    [activeWindow],
  );

  // True when a venue has a happy-hour window on today's venue-local weekday — drives
  // the relevance tier and row muting. Independent of whether it's live right now.
  const runsToday = useCallback(
    (v: VenueListItem): boolean => {
      const tz = v.timezone;
      if (!tz) return false;
      const now = nowByTz.get(tz);
      if (!now) return false;
      return v.happyHours.some((h) => h.daysOfWeek.includes(now.dayOfWeek));
    },
    [nowByTz],
  );

  // City-local clock string ("4:23 PM"). The hh:mm in venueLocalNow is 24-hour;
  // we reformat to a friendly 12-hour string + small tz abbreviation.
  const cityClock = useMemo(() => {
    const now = nowByTz.get(cityTimezone);
    if (!now) return null;
    const [hStr, mStr] = now.hhmm.split(":");
    const h24 = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const period = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const tzAbbr = new Intl.DateTimeFormat("en-US", {
      timeZone: cityTimezone,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return {
      time: `${h12}:${String(m).padStart(2, "0")} ${period}`,
      tz: tzAbbr ?? "",
    };
  }, [nowByTz, cityTimezone]);

  // Data-freshness label ("Updated Jun 3") — the most recent venue edit in scope,
  // shown beneath the clock. Adds a year only when the update wasn't this calendar
  // year, so the common case stays terse. Formatted in the city's timezone for
  // consistency with the clock above it.
  const updatedLabel = useMemo(() => {
    if (!lastUpdated) return null;
    const d = new Date(lastUpdated);
    if (Number.isNaN(d.getTime())) return null;
    // Before mount, assume the common same-year case (no `new Date()`) so the
    // label matches the server; recompute against the real clock once mounted.
    const sameYear =
      !mounted ||
      new Intl.DateTimeFormat("en-US", { timeZone: cityTimezone, year: "numeric" }).format(d) ===
        new Intl.DateTimeFormat("en-US", { timeZone: cityTimezone, year: "numeric" }).format(new Date());
    return new Intl.DateTimeFormat("en-US", {
      timeZone: cityTimezone,
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(d);
  }, [lastUpdated, cityTimezone, mounted]);

  // Count of venues with a happy hour live right now (across the unfiltered set,
  // so this number reflects the city, not the current filter).
  const liveCount = useMemo(
    () => venues.reduce((n, v) => n + (isNowOpen(v) ? 1 : 0), 0),
    [venues, isNowOpen],
  );

  // City-wide count of venues that have happy-hour data — the denominator for the
  // filter-bar count, unaffected by the active filter.
  const totalWithHours = useMemo(
    () => venues.filter((v) => v.happyHours.length > 0).length,
    [venues],
  );

  // Filter + sort
  const { filtered } = useMemo(() => {
    const coords = geo.coords;
    let list = venues.filter((v) => {
      // Text search — match name OR a deal label.
      if (search) {
        const q = search.toLowerCase();
        const inName = v.name.toLowerCase().includes(q);
        const inDeals = v.offerings.some((o) => o.label.toLowerCase().includes(q));
        if (!inName && !inDeals) return false;
      }

      // Neighborhood filter
      if (
        selectedNeighborhoods.size > 0 &&
        (v.neighborhoodName == null || !selectedNeighborhoods.has(v.neighborhoodName))
      )
        return false;

      // Type filter
      if (selectedTypes.size > 0 && (v.type == null || !selectedTypes.has(v.type)))
        return false;

      // Tag filter — venue matches if it has ANY selected tag
      if (selectedTags.size > 0 && !v.tags.some((t) => selectedTags.has(t)))
        return false;

      // Day filter (stub venues pass through unless days are selected — no HH rows to match)
      if (selectedDays.size > 0) {
        const hasDay = v.happyHours.some((h) =>
          h.daysOfWeek.some((d) => selectedDays.has(d)),
        );
        if (!hasDay) return false;
      }

      // Happening-now filter
      if (happeningNow && !isNowOpen(v)) return false;

      return true;
    });

    // Sort
    const isDefaultSort = sortKey === "now";

    list = [...list].sort((a, b) => {
      // Promoted rows pin to top only on default Start-time asc sort (PRD §6.3)
      if (isDefaultSort) {
        const aTier = a.promotionTier !== "none" ? 0 : 1;
        const bTier = b.promotionTier !== "none" ? 0 : 1;
        if (aTier !== bTier) return aTier - bTier;
      }

      const aB = windowBounds(a);
      const bB = windowBounds(b);

      switch (sortKey) {
        case "now": {
          // Relevance tiers: live now → runs today → other days. Ties break on start
          // time, then name. (Stubs render in their own section, so tier 3 is implicit.)
          const tier = (x: VenueListItem) =>
            isNowOpen(x) ? 0 : runsToday(x) ? 1 : 2;
          const at = tier(a);
          const bt = tier(b);
          if (at !== bt) return at - bt;
          const s = (aB.start ?? "99:99").localeCompare(bB.start ?? "99:99");
          return s !== 0 ? s : a.name.localeCompare(b.name);
        }
        case "distance": {
          const d = (v: VenueListItem) =>
            coords && v.lat != null && v.lng != null
              ? haversineMiles(coords, { lat: v.lat, lng: v.lng })
              : Infinity;
          const ad = d(a);
          const bd = d(b);
          return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
        }
        case "startTime": {
          const s = (aB.start ?? "99:99").localeCompare(bB.start ?? "99:99");
          return s !== 0 ? s : a.name.localeCompare(b.name);
        }
        case "endTime": {
          const e = (aB.end ?? "99:99").localeCompare(bB.end ?? "99:99");
          return e !== 0 ? e : a.name.localeCompare(b.name);
        }
        case "name":
          return a.name.localeCompare(b.name);
        case "neighborhood": {
          // Venues with no neighborhood sort last (￿) rather than forming
          // a blank group at the top.
          const an = a.neighborhoodName ?? "￿";
          const bn = b.neighborhoodName ?? "￿";
          const n = an.localeCompare(bn);
          return n !== 0 ? n : a.name.localeCompare(b.name);
        }
        case "type": {
          const t = labelForVenueType(a.type).localeCompare(labelForVenueType(b.type));
          return t !== 0 ? t : a.name.localeCompare(b.name);
        }
        case "price": {
          // Sort by the same signal the column shows: Google price level first
          // (cents fallback ÷ a rough scale), cheapest/unknown last.
          const lvl = (v: VenueListItem) =>
            v.priceLevel ?? (v.minPriceCents != null ? Math.min(4, Math.ceil(v.minPriceCents / 700)) : 99);
          const ap = lvl(a);
          const bp = lvl(b);
          return ap !== bp ? ap - bp : a.name.localeCompare(b.name);
        }
      }
    });

    return { filtered: list };
  }, [
    venues,
    search,
    selectedNeighborhoods,
    selectedDays,
    selectedTypes,
    selectedTags,
    happeningNow,
    isNowOpen,
    runsToday,
    sortKey,
    geo.coords,
  ]);

  // Helpers
  function toggleNeighborhood(name: string) {
    setSelectedNeighborhoods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleIn(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
  ) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleDay(day: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (prev.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  function toggleToday() {
    toggleDay(todayISO);
  }

  function clearFilters() {
    setSelectedNeighborhoods(new Set());
    setSelectedDays(new Set());
    setSelectedTypes(new Set());
    setSelectedTags(new Set());
    setHappeningNow(false);
    setSearch("");
    setSortKey("now");
    // Location is independent of the filters — clearing filters leaves a shared
    // location (and its distance labels) intact. The "Near you" chip's own ✕
    // (clearLocation) is the only thing that drops location.
  }

  function clearLocation() {
    geo.clear();
    setSortKey((k) => (k === "distance" ? "now" : k));
  }

  const hasActiveFilters =
    selectedNeighborhoods.size > 0 ||
    selectedDays.size > 0 ||
    selectedTypes.size > 0 ||
    selectedTags.size > 0 ||
    happeningNow ||
    search !== "" ||
    sortKey !== "now";

  // Badge count for the mobile "Filters" toggle — only the selections that live in
  // the collapsible chip rows (search and sort stay visible, so they don't count).
  const chipFilterCount =
    selectedNeighborhoods.size +
    selectedDays.size +
    selectedTypes.size +
    selectedTags.size +
    (happeningNow ? 1 : 0);

  const withHours = filtered.filter((v) => v.happyHours.length > 0);
  const stubs = filtered.filter((v) => v.happyHours.length === 0);

  if (venues.length === 0) {
    return (
      <div className="mt-12 rounded-lg border border-border bg-bg-surface p-10 text-center">
        <p className="text-lg text-text-primary">Nothing on the tap list yet.</p>
        <p className="mt-2 text-text-muted">
          We only list what we can verify — no guesses, no stale specials.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Live header strip — pulsing live count + city local clock. Counts span the
          whole city (unfiltered) so the number reflects the place, not the filter. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <NowBadge open={liveCount > 0} />
          <span className="font-medium">
            {liveCount > 0 ? (
              <>
                <span className="mr-1 text-accent-warm">{liveCount}</span> happy
                hour{liveCount === 1 ? "" : "s"} live now in {cityName}
              </>
            ) : (
              <>Nothing live right this minute in {cityName}</>
            )}
          </span>
        </div>
        {(cityClock || updatedLabel) && (
          <div className="flex flex-col items-end leading-tight">
            {cityClock && (
              <span
                className="tabular-nums text-sm text-text-muted"
                aria-label={`Local time in ${cityName}`}
              >
                {cityClock.time}
                {cityClock.tz && (
                  <span className="ml-1 text-xs uppercase">{cityClock.tz}</span>
                )}
              </span>
            )}
            {updatedLabel && (
              <span
                className="text-xs text-text-muted/80"
                title="Most recent update to a listing in this view"
              >
                Updated {updatedLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="sticky top-0 z-10 rounded-lg border border-border bg-bg-surface p-3 shadow-sm">
        {/* Row 1: search + sort — stacked on mobile so the sort dropdown never
            squeezes the search input down to a sliver (its placeholder was
            clipping to "Search ve" at 375px). */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            type="search"
            placeholder="Search venues or deals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-cool"
            aria-label="Search venues by name or deal"
          />
          <label className="flex items-center gap-1.5 text-sm text-text-muted">
            <span>Sort:</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="flex-1 rounded border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-cool sm:flex-none"
              aria-label="Sort venues"
            >
              <option value="now">Happening now</option>
              {geo.status === "granted" && (
                <option value="distance">Closest to me</option>
              )}
              <option value="startTime">Start time</option>
              <option value="endTime">End time</option>
              <option value="name">Name</option>
              <option value="neighborhood">Neighborhood</option>
              <option value="type">Type</option>
              <option value="price">Price (low→high)</option>
            </select>
          </label>
        </div>

        {/* Mobile-only disclosure for the chip rows below. */}
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="mt-2 flex w-full items-center justify-between rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text-primary md:hidden"
        >
          <span className="flex items-center gap-1.5">
            Filters
            {chipFilterCount > 0 && (
              <span className="rounded-full bg-accent-cool px-1.5 text-xs font-semibold text-white">
                {chipFilterCount}
              </span>
            )}
          </span>
          <span aria-hidden="true" className="text-xs">
            {filtersOpen ? "▲" : "▼"}
          </span>
        </button>

        {/* Chip rows — always visible on md+, behind the toggle on phones. */}
        <div className={`${filtersOpen ? "block" : "hidden"} md:block`}>

          {/* Row 2: day pills */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold" style={{ color: "var(--filter-day)" }}>
              Day:
            </span>
            <button
              onClick={toggleToday}
              aria-pressed={mounted && selectedDays.has(todayISO)}
              className="pill pill-day rounded-full border px-2.5 py-0.5 text-xs font-medium"
            >
              Today
            </button>
            {ISO_DAYS.map((day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                aria-pressed={selectedDays.has(day)}
                className="pill pill-day rounded-full border px-2.5 py-0.5 text-xs font-medium"
              >
                {DAY_LABELS[day]}
              </button>
            ))}
            <button
              onClick={() => setHappeningNow((v) => !v)}
              aria-pressed={happeningNow}
              className="pill pill-live ml-2 rounded-full border px-2.5 py-0.5 text-xs font-medium"
            >
              Happening now
            </button>
            {geo.status === "granted" ? (
              <span className="pill pill-live pill-on ml-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium">
                <span aria-hidden="true">📍</span> Near you
                <button
                  onClick={clearLocation}
                  aria-label="Clear location"
                  className="ml-0.5 leading-none hover:opacity-80"
                >
                  ✕
                </button>
              </span>
            ) : (
              <button
                onClick={() => geo.request(() => setSortKey("distance"))}
                disabled={geo.status === "prompting"}
                className="pill pill-live ml-2 rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:opacity-60"
              >
                {geo.status === "prompting" ? "Locating…" : "📍 Use my location"}
              </button>
            )}
            {(geo.status === "denied" || geo.status === "unavailable") && (
              <span className="ml-1 text-xs text-text-muted">
                Location unavailable — check your OS location settings for this browser
                (not just the browser&apos;s site permission)
              </span>
            )}
          </div>

          {/* Row 3: neighborhood chips (only if showNeighborhood and there are neighborhoods) */}
          {showNeighborhood && neighborhoods.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold" style={{ color: "var(--filter-area)" }}>
                Area:
              </span>
              {neighborhoods.map((name) => (
                <button
                  key={name}
                  onClick={() => toggleNeighborhood(name)}
                  aria-pressed={selectedNeighborhoods.has(name)}
                  className="pill pill-area rounded-full border px-2.5 py-0.5 text-xs font-medium"
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {/* Row 4: type chips */}
          {types.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold" style={{ color: "var(--filter-type)" }}>
                Type:
              </span>
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleIn(setSelectedTypes, t)}
                  aria-pressed={selectedTypes.has(t)}
                  className="pill pill-type rounded-full border px-2.5 py-0.5 text-xs font-medium"
                >
                  {labelForVenueType(t)}
                </button>
              ))}
            </div>
          )}

          {/* Row 5: tag chips */}
          {tagList.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold" style={{ color: "var(--filter-tag)" }}>
                Tags:
              </span>
              {tagList.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleIn(setSelectedTags, t)}
                  aria-pressed={selectedTags.has(t)}
                  className="pill pill-tag rounded-full border px-2.5 py-0.5 text-xs font-medium"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Count + clear. Splits filtered results into "with data" vs "stub" so the
            two numbers always read consistently with the city/home headers. */}
        <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
          <span>
            {hasActiveFilters ? (
              <>
                Showing {withHours.length} of {totalWithHours} happy hour{" "}
                {totalWithHours === 1 ? "spot" : "spots"}
              </>
            ) : (
              <>
                {withHours.length} happy hour{" "}
                {withHours.length === 1 ? "spot" : "spots"}
              </>
            )}
          </span>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-full border border-accent-hot bg-accent-hot/10 px-3 py-1 text-xs font-semibold text-accent-hot transition-colors hover:bg-accent-hot hover:text-white"
            >
              <span aria-hidden="true">✕</span>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {withHours.length === 0 ? (
        hasActiveFilters ? (
          <div className="mt-8 rounded-lg border border-border bg-bg-surface p-10 text-center">
            <p className="text-text-primary">No happy hours match your filters.</p>
            <button
              onClick={clearFilters}
              className="mt-3 text-sm text-accent-cool hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="mt-8 rounded-lg border border-border bg-bg-surface p-10 text-center">
            <p className="text-text-primary">No happy hours confirmed here yet.</p>
            <p className="mt-2 text-text-muted">Know one? Help us add the first.</p>
          </div>
        )
      ) : (
        <>
          {/* Desktop table */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="bg-bg-elevated text-text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Venue</th>
                  <th className="px-4 py-2 font-medium" title="Happy hour happening right now">
                    Now
                  </th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  {showNeighborhood && (
                    <th className="px-4 py-2 font-medium">Neighborhood</th>
                  )}
                  <th className="px-4 py-2 font-medium">Days</th>
                  <th className="px-4 py-2 font-medium">Start</th>
                  <th className="px-4 py-2 font-medium">End</th>
                  <th className="px-4 py-2 font-medium">Deals</th>
                  <th className="px-4 py-2 font-medium">Price</th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                {withHours.map((v) => {
                  const b = windowBounds(v);
                  const promoted = v.promotionTier !== "none";
                  const deals = dealsPreview(v);
                  const tier = priceTier(v);
                  const live = isNowOpen(v);
                  const today = runsToday(v);
                  // Only dim once mounted — pre-mount everything renders at full
                  // opacity (live/today are both false then), so we'd otherwise
                  // flash every non-promoted row dim, then brighten on hydration.
                  const muted = mounted && !promoted && !live && !today;
                  // Promoted styling wins over live styling — they share the warm
                  // left border, and a venue is unlikely to be both anyway.
                  const rowStyle = promoted
                    ? {
                        backgroundColor: "var(--row-promoted)",
                        borderLeft: "3px solid var(--accent-warm)",
                      }
                    : live
                      ? {
                          backgroundColor:
                            "color-mix(in srgb, var(--accent-warm) 5%, transparent)",
                          borderLeft:
                            "3px solid color-mix(in srgb, var(--accent-warm) 45%, transparent)",
                        }
                      : undefined;
                  const activeW = live ? activeWindow(v) : null;
                  const tz = v.timezone;
                  const tzNow = (tz ? nowByTz.get(tz) : null) ?? null;
                  const endsIn =
                    activeW && tzNow ? minutesUntilWindowEnd(activeW, tzNow) : null;
                  return (
                    <tr
                      key={v.id}
                      className={`border-t border-border hover:bg-row-hover${muted ? " opacity-60" : ""}`}
                      style={rowStyle}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={venuePath(stateSlug, citySlug, v.slug)}
                          className="hover:text-accent-cool"
                        >
                          {v.name}
                        </Link>
                        {geo.coords && (
                          <div className="mt-0.5 text-xs">
                            <DistanceLink origin={geo.coords} venue={v} isApple={isApple} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <NowBadge open={live} />
                          {live && activeW?.allDay ? (
                            <span
                              className="text-xs text-text-muted"
                              title={activeW.notes?.trim() || "All-day deal"}
                            >
                              {activeDealLabel(activeW)}
                            </span>
                          ) : (
                            live &&
                            endsIn != null && (
                              <span className="text-xs text-text-muted">
                                {formatRemaining(endsIn)}
                              </span>
                            )
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {labelForVenueType(v.type) || "—"}
                      </td>
                      {showNeighborhood && (
                        <td className="px-4 py-3 text-text-muted">
                          {v.neighborhoodName ?? "—"}
                        </td>
                      )}
                      <td className="px-4 py-3">{b.days}</td>
                      <td className="px-4 py-3 text-accent-warm" colSpan={2}>
                        {formatWindow(displayBounds(v, activeW, tzNow))}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {deals.text ? (
                          <Link
                            href={venuePath(stateSlug, citySlug, v.slug)}
                            className="hover:text-accent-cool"
                            title={`See all deals at ${v.name}`}
                          >
                            {deals.text}
                            {deals.extra > 0 && (
                              <span className="text-accent-cool"> +{deals.extra}</span>
                            )}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className="px-4 py-3 text-accent-warm"
                        title={
                          formatPrice(v.minPriceCents) ?? undefined
                        }
                      >
                        {tier ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mt-4 flex flex-col gap-3 md:hidden">
            {withHours.map((v) => {
              const b = windowBounds(v);
              const promoted = v.promotionTier !== "none";
              const deals = dealsPreview(v);
              const tier = priceTier(v);
              const live = isNowOpen(v);
              const today = runsToday(v);
              const muted = !promoted && !live && !today;
              const cardStyle = promoted
                ? {
                    backgroundColor: "var(--row-promoted)",
                    borderLeft: "3px solid var(--accent-warm)",
                  }
                : live
                  ? {
                      backgroundColor:
                        "color-mix(in srgb, var(--accent-warm) 5%, transparent)",
                      borderLeft:
                        "3px solid color-mix(in srgb, var(--accent-warm) 45%, transparent)",
                    }
                  : undefined;
              const activeW = live ? activeWindow(v) : null;
              const tz = v.timezone;
              const tzNow = (tz ? nowByTz.get(tz) : null) ?? null;
              const endsIn =
                activeW && tzNow ? minutesUntilWindowEnd(activeW, tzNow) : null;
              return (
                <div
                  key={v.id}
                  className={`rounded-lg border border-border bg-bg-surface px-4 py-3${muted ? " opacity-60" : ""}`}
                  style={cardStyle}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={venuePath(stateSlug, citySlug, v.slug)}
                      className="font-medium text-text-primary hover:text-accent-cool"
                    >
                      {v.name}
                      {live && <NowBadge className="ml-2" />}
                    </Link>
                    {tier && (
                      <span
                        className="text-sm text-accent-warm"
                        title={formatPrice(v.minPriceCents) ?? undefined}
                      >
                        {tier}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {[labelForVenueType(v.type) || null, showNeighborhood ? v.neighborhoodName : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {geo.coords && (
                    <p className="mt-0.5 text-xs">
                      <DistanceLink origin={geo.coords} venue={v} isApple={isApple} />
                    </p>
                  )}
                  <p className="mt-1 text-sm text-text-primary">{b.days}</p>
                  <p className="mt-0.5 text-sm tabular-nums">
                    <span className="text-accent-warm">
                      {formatWindow(displayBounds(v, activeW, tzNow))}
                    </span>
                    {live && activeW?.allDay ? (
                      <span
                        className="ml-2 text-xs text-text-muted"
                        title={activeW.notes?.trim() || "All-day deal"}
                      >
                        · {activeDealLabel(activeW)}
                      </span>
                    ) : (
                      live &&
                      endsIn != null && (
                        <span className="ml-2 text-xs text-text-muted">
                          · {formatRemaining(endsIn)}
                        </span>
                      )
                    )}
                  </p>
                  {deals.text && (
                    <Link
                      href={venuePath(stateSlug, citySlug, v.slug)}
                      className="mt-1 block text-xs text-text-muted hover:text-accent-cool"
                      title={`See all deals at ${v.name}`}
                    >
                      {deals.text}
                      {deals.extra > 0 && (
                        <span className="text-accent-cool"> +{deals.extra}</span>
                      )}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Stubs — folded into an opt-in disclosure so the default view is all signal.
          Honest, not hidden: clearly labeled, one click away, reframed as crowdsourcing. */}
      {stubs.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowStubs((s) => !s)}
            aria-expanded={showStubs}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg-surface px-4 py-3 text-left text-sm text-text-muted transition-colors hover:border-accent-cool hover:text-text-primary"
          >
            <span>
              <span aria-hidden="true" className="mr-1.5 font-medium">
                {showStubs ? "−" : "＋"}
              </span>
              {stubs.length} more {stubs.length === 1 ? "spot" : "spots"} we&apos;re still confirming — know {stubs.length === 1 ? "it" : "one"}? Help us add it ❤️
            </span>
            <span aria-hidden="true" className="shrink-0 text-xs uppercase tracking-wide">
              {showStubs ? "Hide" : "Show"}
            </span>
          </button>
          {showStubs && (
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {stubs.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <span>
                    <Link
                      href={venuePath(stateSlug, citySlug, v.slug)}
                      className="text-text-primary hover:text-accent-cool"
                    >
                      {v.name}
                    </Link>
                    {(labelForVenueType(v.type) ||
                      (showNeighborhood && v.neighborhoodName)) && (
                      <span className="ml-2 text-xs text-text-muted">
                        {[
                          labelForVenueType(v.type) || null,
                          showNeighborhood ? v.neighborhoodName : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                    {geo.coords && (
                      <span className="ml-2 text-xs">
                        <DistanceLink origin={geo.coords} venue={v} isApple={isApple} />
                      </span>
                    )}
                  </span>
                  <Link
                    href={`${venuePath(stateSlug, citySlug, v.slug)}#add-happy-hour`}
                    className="shrink-0 text-accent-cool hover:underline"
                  >
                    Help us add it →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
