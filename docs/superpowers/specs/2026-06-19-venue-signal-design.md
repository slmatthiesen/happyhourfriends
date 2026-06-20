# Venue signal ("thumbs up") — design

**Date:** 2026-06-19
**Status:** Approved, pre-implementation
**Branch:** `feat/venue-signal-thumbs`

## Goal

A lightweight, positive-only sentiment tap on each venue page. One thumbs-up button
in the upper-right of the venue header showing a running count (`👍 42`). Deliberately
ambiguous — "this is a good one" / "this helped me" — never a star-rating that grades
or knocks the venue. Not forced, just present.

## Decisions (operator-confirmed)

- **About the listing, not the venue.** Friendly endorsement of the page/data being
  useful, not a quality grade of the restaurant. No caption text — the icon carries it.
- **Positive-only, one-way.** A single tap. No down-vote, no untap. It's a gesture,
  not a rating the user manages.
- **Icon: thumbs up 👍.** Ambiguous on purpose — "whatever people want it to be."
- **Dedup by both IP and localStorage fingerprint**, same anti-abuse posture as flags.

## Why a dedicated table, NOT `community_flags` reuse

`community_flags` is a *moderation* structure: every consumer assumes a flag is a problem
that resolves and triggers an action. Reusing it for a positive counter is a semantic
mismatch with real cost:

- `lib/trust/flagResolution.ts#resolveOpenFlags` loads every unresolved flag and, via
  `thresholdFor()` (which falls back to 5-confirm for *unknown* types), would mark a
  positive signal "resolved" at 5 taps — breaking dedup (dedup only counts unresolved
  rows) and tripping downstream moderation. Avoiding that needs a special-case exclusion
  in the resolver, maintained forever. "Special case for X" is a smell.
- `vote_value` would be dead weight (always `confirm`); there is no deny side.
- `scripts/triage-stub-sites.ts` counts `community_flags` rows as "this venue has
  engagement, don't delete it" — positive taps would leak into delete-protection logic
  unintentionally.

A dedicated table is cleaner *and* less code: dedup is a DB unique constraint instead of
a hand-maintained resolver exclusion, and the signal can never resolve, hide a venue, or
enter moderation.

## Data model

New table **`venue_signals`** (new migration; never edit an existing one):

| column        | type                              | notes                                  |
|---------------|-----------------------------------|----------------------------------------|
| `id`          | uuid pk default random            |                                        |
| `venue_id`    | uuid not null FK → `venues.id`     | on delete cascade                      |
| `kind`        | text not null default `'good'`    | extension point (e.g. future `'star'`) |
| `fingerprint` | text                              | localStorage anon id                   |
| `ip`          | inet                              | captured server-side                   |
| `created_at`  | timestamptz not null default now  |                                        |

- **`UNIQUE(venue_id, kind, fingerprint)`** — the dedup. One tap per fingerprint per kind.
- Index on `(venue_id, kind)` for the count query.
- `kind` defaults to `'good'` (icon-agnostic, matches "this is a good one"). Adding a
  second reaction later is a new `kind` value, not a migration.

Drizzle schema goes in `db/schema/` alongside the other ops/community tables (sibling to
`community_flags` in `moderation.ts`, or a new `signals` grouping — match existing file
boundaries during implementation).

## API

New route **`POST /api/signals`** — a trimmed sibling of `/api/flags`:

- Body: `{ venueId, kind?: 'good', fingerprint, website? /* honeypot */ }`.
- **Reuses the anti-abuse helpers** from `lib/trust/submitter`: `hashIp`,
  `checkBasicRateLimit`, `ensureSubmitter`, plus the honeypot pattern.
- **No visible hCaptcha** — a captcha challenge on a one-tap delight kills it. Abuse
  ceiling is trivial (worst case someone pads a positive number; it can't harm a venue).
  Honeypot + IP/fingerprint dedup + rate-limit are sufficient.
- Insert with `ON CONFLICT (venue_id, kind, fingerprint) DO NOTHING`. Conflict → return
  `200 { ok: true, duplicate: true }`. Fresh insert → `201 { ok: true }`.
- IP captured from `x-forwarded-for` / `x-real-ip` exactly as `/api/flags` does.

## Read path

- `lib/queries/venues.ts#getVenueBySlug` returns a `signalCount` for the venue
  (`count(*) where venue_id = ? and kind = 'good'`). One extra cheap aggregate alongside
  the existing venue load.
- Venue page passes `signalCount` to the button component.

## UI

New client component **`components/signal/signal-button.tsx`**:

- Renders in the venue header's upper-right, grouped with the "Updated" date
  (`app/[state]/[city]/venue/[slug]/page.tsx`, the `flex items-start justify-between`
  header block).
- Pill button: thumbs-up glyph + count. **Count shown only when ≥1** — at zero it's just
  the icon (no lonely "0" on a fresh listing).
- Tap → optimistic increment + filled/active style; POSTs to `/api/signals` with the
  localStorage fingerprint (`hhf_fp`, same key as `flag-widget.tsx` / `submission-form.tsx`).
- One-way: once tapped (tracked in localStorage per venue), the button stays filled and
  re-tap is a no-op. Persists across reloads.
- No caption, no hCaptcha widget. Honeypot input hidden off the a11y tree, mirroring
  `flag-widget.tsx`.
- Gated behind **`uiFlags.signals`** in `lib/ui/flags.ts` (kill switch, like the rest of
  the personality round). Server reads the flag and omits the button cleanly when false.

## Error handling

- Network/500 → silently revert the optimistic increment, leave the button tappable
  again. No error banner for a delight gesture.
- Duplicate (`duplicate: true`) → treat as success, keep filled.

## Testing

- **DB/dedup:** unique constraint rejects a second insert for the same
  `(venue_id, kind, fingerprint)`; `ON CONFLICT DO NOTHING` returns the duplicate path.
- **API:** honeypot filled → no insert; missing fingerprint → 400; happy path inserts;
  rate-limit path returns 429.
- **Resolver isolation:** assert `resolveOpenFlags` is untouched by `venue_signals`
  (no shared table) — i.e. a regression guard that positive taps never enter moderation.
- **Query:** `getVenueBySlug` returns correct `signalCount`.
- **Component:** optimistic increment, revert on failure, filled-after-tap persistence.

## Out of scope (YAGNI)

- No admin surface for signals (no review queue — there's nothing to moderate).
- No ranking/badging of venues by signal count (the `kind` column leaves the door open;
  not built now).
- No second reaction type yet (star/heart) — schema supports it, UI ships one.
- No prod analytics event beyond the DB row (can add a PostHog capture later if wanted).
