"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { formatDays, formatPrice, formatTime } from "@/lib/format";
import { venueLocalNow, isWindowActive } from "@/lib/geo/timezone";
import type { VenueListItem } from "@/lib/queries/venues";

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

type SortKey = "now" | "startTime" | "endTime" | "name" | "neighborhood" | "type" | "price";

function windowBounds(v: VenueListItem) {
  const starts = v.happyHours.map((h) => h.startTime).sort();
  const ends = v.happyHours
    .map((h) => h.endTime)
    .filter((e): e is string => e != null)
    .sort();
  return {
    days: formatDays(v.happyHours.flatMap((h) => h.daysOfWeek)),
    start: starts[0] ?? null,
    end: ends.length ? ends[ends.length - 1] : null,
  };
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

export function VenueTableClient({
  citySlug,
  venues,
  showNeighborhood = true,
}: {
  citySlug: string;
  venues: VenueListItem[];
  showNeighborhood?: boolean;
}): React.JSX.Element {
  // Filter state
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<Set<string>>(new Set());
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [happeningNow, setHappeningNow] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("now");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Derived neighborhoods list
  const neighborhoods = useMemo(() => {
    const names = new Set<string>();
    for (const v of venues) {
      if (v.neighborhoodName) names.add(v.neighborhoodName);
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

  // Cache venueLocalNow per timezone — computed every render so the live "Now" badge
  // is always available, not only when the happening-now filter is on.
  const nowByTz = useMemo(() => {
    const map = new Map<string, ReturnType<typeof venueLocalNow>>();
    const now = new Date();
    for (const v of venues) {
      const tz = v.timezone;
      if (tz && !map.has(tz)) map.set(tz, venueLocalNow(tz, now));
    }
    return map;
  }, [venues]);

  const isNowOpen = useCallback(
    (v: VenueListItem): boolean => {
      const tz = v.timezone;
      if (!tz) return false;
      const now = nowByTz.get(tz);
      if (!now) return false;
      return v.happyHours.some((h) => isWindowActive(h, now));
    },
    [nowByTz],
  );

  // Filter + sort
  const { filtered, total } = useMemo(() => {
    const total = venues.length;

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
          // Happening-now venues float to the top; ties break on start time.
          const an = isNowOpen(a) ? 0 : 1;
          const bn = isNowOpen(b) ? 0 : 1;
          if (an !== bn) return an - bn;
          const s = (aB.start ?? "99:99").localeCompare(bB.start ?? "99:99");
          return s !== 0 ? s : a.name.localeCompare(b.name);
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
          const t = (a.type ?? "~").localeCompare(b.type ?? "~");
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

    return { filtered: list, total };
  }, [
    venues,
    search,
    selectedNeighborhoods,
    selectedDays,
    selectedTypes,
    selectedTags,
    happeningNow,
    isNowOpen,
    sortKey,
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
  }

  const hasActiveFilters =
    selectedNeighborhoods.size > 0 ||
    selectedDays.size > 0 ||
    selectedTypes.size > 0 ||
    selectedTags.size > 0 ||
    happeningNow ||
    search !== "" ||
    sortKey !== "now";

  const withHours = filtered.filter((v) => v.happyHours.length > 0);
  const stubs = filtered.filter((v) => v.happyHours.length === 0);

  // Columns: Venue, Now, Type, [Neighborhood], Days, Start, End, Deals, Price.
  const colCount = 8 + (showNeighborhood ? 1 : 0);
  // Leading cells a stub row renders before its "help us add it" span: Venue, Now, Type, [Nb].
  const stubLeadingCols = 3 + (showNeighborhood ? 1 : 0);

  function NowBadge({ open = true, className = "" }: { open?: boolean; className?: string }) {
    return open ? (
      <span
        title="Happy hour happening now"
        aria-label="Happy hour happening now"
        className={`inline-flex items-center align-middle text-sm leading-none ${className}`}
      >
        🎉
      </span>
    ) : (
      <span
        title="Not happening right now — check the days and times"
        aria-label="Not happening right now"
        className={`inline-flex items-center align-middle text-sm leading-none opacity-40 grayscale ${className}`}
      >
        ⏳
      </span>
    );
  }

  if (venues.length === 0) {
    return (
      <div className="mt-12 rounded-lg border border-border bg-bg-surface p-10 text-center">
        <p className="text-lg text-text-primary">No venues listed yet.</p>
        <p className="mt-2 text-text-muted">
          We add venues only with a verifiable source — no guesses.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Filter bar */}
      <div className="sticky top-0 z-10 rounded-lg border border-border bg-bg-surface p-3 shadow-sm">
        {/* Row 1: search + sort */}
        <div className="flex flex-wrap items-center gap-2">
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
              className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-cool"
              aria-label="Sort venues"
            >
              <option value="now">🎉 Happening now</option>
              <option value="startTime">Start time</option>
              <option value="endTime">End time</option>
              <option value="name">Name</option>
              <option value="neighborhood">Neighborhood</option>
              <option value="type">Type</option>
              <option value="price">Price (low→high)</option>
            </select>
          </label>
        </div>

        {/* Row 2: day pills */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted">Day:</span>
          <button
            onClick={toggleToday}
            aria-pressed={selectedDays.has(todayISO)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              selectedDays.has(todayISO)
                ? "border-accent-cool bg-accent-cool text-white"
                : "border-border bg-bg-elevated text-text-muted hover:border-accent-cool hover:text-text-primary"
            }`}
          >
            Today
          </button>
          {ISO_DAYS.map((day) => (
            <button
              key={day}
              onClick={() => toggleDay(day)}
              aria-pressed={selectedDays.has(day)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                selectedDays.has(day)
                  ? "border-accent-cool bg-accent-cool text-white"
                  : "border-border bg-bg-elevated text-text-muted hover:border-accent-cool hover:text-text-primary"
              }`}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
          <button
            onClick={() => setHappeningNow((v) => !v)}
            aria-pressed={happeningNow}
            className={`ml-2 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              happeningNow
                ? "border-accent-warm bg-accent-warm text-white"
                : "border-border bg-bg-elevated text-text-muted hover:border-accent-warm hover:text-text-primary"
            }`}
          >
            Happening now
          </button>
        </div>

        {/* Row 3: neighborhood chips (only if showNeighborhood and there are neighborhoods) */}
        {showNeighborhood && neighborhoods.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted">Area:</span>
            {neighborhoods.map((name) => (
              <button
                key={name}
                onClick={() => toggleNeighborhood(name)}
                aria-pressed={selectedNeighborhoods.has(name)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  selectedNeighborhoods.has(name)
                    ? "border-accent-cool bg-accent-cool text-white"
                    : "border-border bg-bg-elevated text-text-muted hover:border-accent-cool hover:text-text-primary"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Row 4: type chips */}
        {types.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted">Type:</span>
            {types.map((t) => (
              <button
                key={t}
                onClick={() => toggleIn(setSelectedTypes, t)}
                aria-pressed={selectedTypes.has(t)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  selectedTypes.has(t)
                    ? "border-accent-cool bg-accent-cool text-white"
                    : "border-border bg-bg-elevated text-text-muted hover:border-accent-cool hover:text-text-primary"
                }`}
              >
                {t.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}

        {/* Row 5: tag chips */}
        {tagList.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted">Tags:</span>
            {tagList.map((t) => (
              <button
                key={t}
                onClick={() => toggleIn(setSelectedTags, t)}
                aria-pressed={selectedTags.has(t)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  selectedTags.has(t)
                    ? "border-accent-cool bg-accent-cool text-white"
                    : "border-border bg-bg-elevated text-text-muted hover:border-accent-cool hover:text-text-primary"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Count + clear */}
        <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
          <span>
            {filtered.length} of {total} venue{total !== 1 ? "s" : ""}
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

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-bg-surface p-10 text-center">
          <p className="text-text-primary">No venues match your filters.</p>
          <button
            onClick={clearFilters}
            className="mt-3 text-sm text-accent-cool hover:underline"
          >
            Clear filters
          </button>
        </div>
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
                  return (
                    <tr
                      key={v.id}
                      className="border-t border-border hover:bg-row-hover"
                      style={
                        promoted
                          ? {
                              backgroundColor: "var(--row-promoted)",
                              borderLeft: "3px solid var(--accent-warm)",
                            }
                          : undefined
                      }
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/${citySlug}/venue/${v.slug}`}
                          className="hover:text-accent-cool"
                        >
                          {v.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <NowBadge open={isNowOpen(v)} />
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {v.type ? v.type.replace(/_/g, " ") : "—"}
                      </td>
                      {showNeighborhood && (
                        <td className="px-4 py-3 text-text-muted">
                          {v.neighborhoodName ?? "—"}
                        </td>
                      )}
                      <td className="px-4 py-3">{b.days}</td>
                      <td className="px-4 py-3 text-accent-warm">{formatTime(b.start)}</td>
                      <td className="px-4 py-3">{formatTime(b.end)}</td>
                      <td className="px-4 py-3 text-text-muted">
                        {deals.text ? (
                          <>
                            {deals.text}
                            {deals.extra > 0 && (
                              <span className="text-accent-cool"> +{deals.extra}</span>
                            )}
                          </>
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
                {stubs.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-border text-text-muted hover:bg-row-hover"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/${citySlug}/venue/${v.slug}`}
                        className="hover:text-accent-cool"
                      >
                        {v.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">—</td>
                    <td className="px-4 py-3">
                      {v.type ? v.type.replace(/_/g, " ") : "—"}
                    </td>
                    {showNeighborhood && (
                      <td className="px-4 py-3">{v.neighborhoodName ?? "—"}</td>
                    )}
                    <td
                      className="px-4 py-3 text-accent-cool"
                      colSpan={colCount - stubLeadingCols}
                    >
                      Does this place have a happy hour? Help us add it →
                    </td>
                  </tr>
                ))}
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
              return (
                <div
                  key={v.id}
                  className="rounded-lg border border-border bg-bg-surface px-4 py-3"
                  style={
                    promoted
                      ? {
                          backgroundColor: "var(--row-promoted)",
                          borderLeft: "3px solid var(--accent-warm)",
                        }
                      : undefined
                  }
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/${citySlug}/venue/${v.slug}`}
                      className="font-medium text-text-primary hover:text-accent-cool"
                    >
                      {v.name}
                      {isNowOpen(v) && <NowBadge className="ml-2" />}
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
                    {[v.type?.replace(/_/g, " "), showNeighborhood ? v.neighborhoodName : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1 text-sm text-text-primary">{b.days}</p>
                  <p className="mt-0.5 text-sm tabular-nums">
                    <span className="text-accent-warm">{formatTime(b.start)}</span>
                    {" – "}
                    <span>{formatTime(b.end)}</span>
                  </p>
                  {deals.text && (
                    <p className="mt-1 text-xs text-text-muted">
                      {deals.text}
                      {deals.extra > 0 && (
                        <span className="text-accent-cool"> +{deals.extra}</span>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
            {stubs.map((v) => (
              <div
                key={v.id}
                className="rounded-lg border border-border bg-bg-surface px-4 py-3 text-text-muted"
              >
                <Link
                  href={`/${citySlug}/venue/${v.slug}`}
                  className="font-medium hover:text-accent-cool"
                >
                  {v.name}
                </Link>
                {(v.type || (showNeighborhood && v.neighborhoodName)) && (
                  <p className="mt-0.5 text-xs">
                    {[v.type?.replace(/_/g, " "), showNeighborhood ? v.neighborhoodName : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <p className="mt-1 text-sm text-accent-cool">
                  Does this place have a happy hour? Help us add it →
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
