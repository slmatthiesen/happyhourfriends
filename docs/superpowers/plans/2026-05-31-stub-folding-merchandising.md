# Stub-Folding & Merchandising Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the city directory lead with its strong happy-hour count and fold stub venues into an opt-in, clearly-labeled disclosure — so the page reads as full of signal without ever hiding or fabricating data.

**Architecture:** Presentation-only change in two files. The page header (`app/[city]/page.tsx`) drops the stub count from its hero line. The shared table component (`components/venue-table-client.tsx`) renders only HH venues in the main list and moves stub rows into a collapsible section beneath it. No schema, query, or data changes.

**Tech Stack:** Next.js 16 App Router (React 19 server + client components), TypeScript strict, Tailwind 4.

**Testing note (deviation from TDD):** This repo has **no React component test harness** (no vitest/jest/RTL — `package.json` test scripts are standalone `tsx` logic scripts only). The changes are pure JSX/presentation. Per the spec and the project's established pattern for UI work, verification is `npm run typecheck` + `npm run lint` + `npm run build` (all must stay clean modulo the 2 pre-existing Phase 0 lint issues) plus a manual smoke check. Writing a bespoke component-test framework here would violate YAGNI and the codebase's conventions.

**Spec:** `docs/superpowers/specs/2026-05-31-stub-folding-merchandising-design.md`

---

## Task 1: Page header — lead with the strong count

**Files:**
- Modify: `app/[city]/page.tsx` (lines ~32-33 and ~45-61)

- [ ] **Step 1: Remove the now-unused `stubs` count variable**

The hero no longer renders a stub count, so this derived value becomes dead (and would
trip strict lint as an unused var).

Replace:

```tsx
  const withHours = venues.filter((v) => v.happyHours.length > 0).length;
  const stubs = venues.length - withHours;
```

with:

```tsx
  const withHours = venues.filter((v) => v.happyHours.length > 0).length;
```

- [ ] **Step 2: Rewrite the header subline to lead with the win**

Replace the entire subline paragraph:

```tsx
        <p className="mt-2 text-text-muted">
          {withHours > 0 || stubs > 0 ? (
            <>
              <span className="text-text-primary">{withHours}</span>{" "}
              {withHours === 1 ? "venue" : "venues"} with happy hours
              {stubs > 0 && (
                <>
                  {" · "}
                  <span className="text-text-primary">{stubs}</span>{" "}
                  stub{stubs === 1 ? "" : "s"} needing help
                </>
              )}
            </>
          ) : (
            "We're still gathering happy hours here — help us fill it in."
          )}
        </p>
```

with:

```tsx
        <p className="mt-2 text-text-muted">
          {withHours > 0 ? (
            <>
              <span className="text-text-primary">{withHours}</span>{" "}
              happy hour {withHours === 1 ? "spot" : "spots"} in {city.name}
            </>
          ) : (
            "We're still gathering happy hours here — help us fill it in."
          )}
        </p>
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (clean except the 2 pre-existing Phase 0 issues in `db/schema/moderation.ts`
and `scripts/import-neighborhoods.ts`). No new errors referencing `app/[city]/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "app/[city]/page.tsx"
git commit -m "feat(ux): header leads with happy-hour count, drops stub count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fold stubs into an opt-in disclosure in the venue table

**Files:**
- Modify: `components/venue-table-client.tsx`

All edits land in one commit because they are interdependent (a strict-lint-clean
intermediate isn't possible — e.g. the new `showStubs` state is unused until the expander
exists, and the `colCount` const is unused once the stub `<tr>` is gone).

- [ ] **Step 1: Add `showStubs` state**

Find the filter-state block and add the disclosure state. Replace:

```tsx
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
```

with:

```tsx
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  // Stubs are folded into an opt-in disclosure (collapsed by default).
  const [showStubs, setShowStubs] = useState(false);
```

- [ ] **Step 2: Add an unfiltered `totalWithHours` memo**

The filter-bar count needs the city-wide (unfiltered) HH count as its denominator.
Add it right after the `liveCount` memo. Replace:

```tsx
  const liveCount = useMemo(
    () => venues.reduce((n, v) => n + (isNowOpen(v) ? 1 : 0), 0),
    [venues, isNowOpen],
  );
```

with:

```tsx
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
```

- [ ] **Step 3: Drop the `total` value from the filter useMemo (it's no longer displayed)**

Replace the destructure line:

```tsx
  const { filtered, total } = useMemo(() => {
    const total = venues.length;

    let list = venues.filter((v) => {
```

with:

```tsx
  const { filtered } = useMemo(() => {
    let list = venues.filter((v) => {
```

Then replace the memo's return:

```tsx
    return { filtered: list, total };
  }, [
```

with:

```tsx
    return { filtered: list };
  }, [
```

- [ ] **Step 4: Remove the now-dead column-count consts**

These are only used by the inline stub `<tr>` colSpan, which is being removed. Replace:

```tsx
  const withHours = filtered.filter((v) => v.happyHours.length > 0);
  const stubs = filtered.filter((v) => v.happyHours.length === 0);

  // Columns: Venue, Now, Type, [Neighborhood], Days, Start, End, Deals, Price.
  const colCount = 8 + (showNeighborhood ? 1 : 0);
  // Leading cells a stub row renders before its "help us add it" span: Venue, Now, Type, [Nb].
  const stubLeadingCols = 3 + (showNeighborhood ? 1 : 0);
```

with:

```tsx
  const withHours = filtered.filter((v) => v.happyHours.length > 0);
  const stubs = filtered.filter((v) => v.happyHours.length === 0);
```

- [ ] **Step 5: Reword the filter-bar count to lead with the HH count**

Replace:

```tsx
          <span>
            Showing {filtered.length} of {total} venue{total !== 1 ? "s" : ""}
            {filtered.length > 0 && (
              <>
                {" — "}
                {withHours.length} with data
                {stubs.length > 0 && <> · {stubs.length} stub{stubs.length === 1 ? "" : "s"}</>}
              </>
            )}
          </span>
```

with:

```tsx
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
```

- [ ] **Step 6: Switch the empty-state branch to key off HH venues only**

The main list now shows only HH venues, so its empty state must trigger on
`withHours.length === 0` (not the combined `filtered.length`), and it must distinguish
"filtered to nothing" from "no HH here yet." Replace:

```tsx
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
```

with:

```tsx
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
```

- [ ] **Step 7: Remove the inline stub `<tr>` block from the desktop table**

Delete the entire desktop stub map (it follows the `withHours.map(...)` block, just before
`</tbody>`):

```tsx
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
                      {labelForVenueType(v.type) || "—"}
                    </td>
                    {showNeighborhood && (
                      <td className="px-4 py-3">{v.neighborhoodName ?? "—"}</td>
                    )}
                    <td
                      className="px-4 py-3"
                      colSpan={colCount - stubLeadingCols}
                    >
                      <Link
                        href={`/${citySlug}/venue/${v.slug}#add-happy-hour`}
                        className="text-accent-cool hover:underline"
                      >
                        Does this place have a happy hour? Help us add it →
                      </Link>
                    </td>
                  </tr>
                ))}
```

Leave the `withHours.map(...)` block and the closing `</tbody></table></div>` intact.

- [ ] **Step 8: Remove the inline stub card block from the mobile list**

Delete the entire mobile stub map (it follows the mobile `withHours.map(...)` block, just
before the closing `</div>` of the mobile card container):

```tsx
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
                {(labelForVenueType(v.type) || (showNeighborhood && v.neighborhoodName)) && (
                  <p className="mt-0.5 text-xs">
                    {[labelForVenueType(v.type) || null, showNeighborhood ? v.neighborhoodName : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <Link
                  href={`/${citySlug}/venue/${v.slug}#add-happy-hour`}
                  className="mt-1 block text-sm text-accent-cool hover:underline"
                >
                  Does this place have a happy hour? Help us add it →
                </Link>
              </div>
            ))}
```

- [ ] **Step 9: Add the folded stub disclosure beneath the main list**

This renders OUTSIDE the `withHours.length === 0 ? ... : (...)` ternary so stubs are always
reachable — even when the HH list is empty. Find the end of that ternary and the component's
closing tags:

```tsx
          </div>
        </>
      )}
    </div>
  );
}
```

Replace with:

```tsx
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
              {stubs.length} more {stubs.length === 1 ? "spot" : "spots"} we&apos;re
              still confirming — know {stubs.length === 1 ? "it" : "one"}? Help us add it
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
                      href={`/${citySlug}/venue/${v.slug}`}
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
                  </span>
                  <Link
                    href={`/${citySlug}/venue/${v.slug}#add-happy-hour`}
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
```

- [ ] **Step 10: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (clean except the 2 pre-existing Phase 0 issues). Specifically confirm
there are NO "unused variable" errors for `total`, `colCount`, `stubLeadingCols`, or
`showStubs` in `components/venue-table-client.tsx`.

- [ ] **Step 11: Commit**

```bash
git add components/venue-table-client.tsx
git commit -m "feat(ux): fold stubs into opt-in disclosure, main list shows HH only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: Compiles successfully. (One benign Turbopack NFT file-trace warning from the
upload store's `fs` use is pre-existing and harmless — not a failure.)

- [ ] **Step 2: Manual smoke check (requires Docker + local DB up)**

Run: `docker compose up -d && npm run dev`, then visit `http://localhost:3000/tacoma`.
Confirm:
- Header reads "N happy hour spots in Tacoma" with no stub count.
- The main table/cards show only venues with happy hours.
- A collapsed disclosure appears at the bottom: "＋ M more spots we're still confirming…".
- Clicking it expands a clean labeled list (name · type · neighborhood · "Help us add it →"),
  with no blank Days/Start/End/Price columns.
- The filter-bar count reads "N happy hour spots" (and "Showing X of N happy hour spots"
  when a filter is active).
- Visit a neighborhood page (e.g. a `/tacoma/<neighborhood>` link) and confirm it folds
  stubs the same way.
- Apply a day filter that removes all HH venues in a neighborhood: the main list shows
  "No happy hours match your filters" AND the stub disclosure still renders below.

If Docker/DB is unavailable, note that the manual check was skipped and rely on the
typecheck/lint/build gate — do not claim the manual check passed.

---

## Self-Review

**Spec coverage:**
- §1 Page header → Task 1. ✓
- §2 Table HH-only + folded stubs (state, desktop, mobile, expander) → Task 2 Steps 1, 6-9. ✓
- §3 Filter-bar count rewording (lead with HH, `totalWithHours` denominator) → Task 2 Steps 2-3, 5. ✓
- §4 Edge cases: filter→0 HH but stubs present (expander outside ternary) → Step 9; filters apply to stubs (stubs derived from `filtered`) → unchanged at Step 4; zero-venue early return → untouched; mobile → Steps 8-9. ✓
- Neighborhood page needs no header change (confirmed during brainstorming) → noted, covered by shared component. ✓
- Verification (typecheck/lint/build + manual) → Tasks 1, 2, 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete before/after strings. ✓

**Type/name consistency:** `showStubs`/`setShowStubs`, `totalWithHours`, `withHours`,
`stubs`, `hasActiveFilters`, `clearFilters`, `labelForVenueType`, `citySlug`,
`showNeighborhood` all match existing/added identifiers. `total` is removed in the same
task it stops being referenced (Step 3 + Step 5). `colCount`/`stubLeadingCols` removed in
the same task their only consumer (the stub `<tr>`) is deleted (Step 4 + Step 7). ✓
