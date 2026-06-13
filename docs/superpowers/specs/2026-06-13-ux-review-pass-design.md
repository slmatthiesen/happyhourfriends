# UX/UI Review Pass — Design

**Date:** 2026-06-13
**Branch:** `feat/ux-review-pass`
**Status:** Approved direction (decisions locked via brainstorming); pending spec review

A focused polish pass on the public reading surface. No new features — copy, link
treatment, page chrome, and decorative tuning. Operator-driven decisions are locked
below; values marked *(verify in impl)* get eyeballed against the dark bg + aurora
during build.

## Locked decisions

- **Landing copy:** "Friendly + community" voice — keep a light contribute nudge framed
  as community, drop the formal directive.
- **Home link:** Text wordmark + small `🍻` glyph + hover underline (not a button).
- **Link color:** Warm the accent — replace cool blue with a warm tone, applied
  consistently everywhere a link appears.
- **Scope:** Just the 8 items below. No shared footer on city/venue pages, no header
  city-switcher this pass (deferred).

## The 8 changes

### 1. Landing copy (`app/page.tsx`)

Replace the two flagged lines. Current:

- P1 ends: "…find your spot. And when something's off, fix it."
- P2 (bold directive): "Come in, find a place to eat and drink."

New ("Friendly + community"):

- P1: "Just the data you want — none of the fluff, no extra pages. Sort it, filter it,
  find your spot. Snap a pic to add a spot or fix a deal — we keep each other in the loop."
- Picker lead (replaces P2): "Find your spot:" (casual, sits directly above the
  `CityPicker`).

Also update the `metadata.description` to drop "If something's off, help fix it" demand
in favor of the same community framing (keep it within ~155 chars for SEO).

### 2. Warm the link accent (`app/globals.css`)

`--accent-cool: #6b9ee8` is the only colored text on the public reading surface and its
declared role is "links, secondary actions." Repoint it to a warm clay tone so every
link/secondary action warms consistently in one place.

- New value: warm clay/terracotta, candidate `#d98a5c` *(verify in impl: contrast on
  `#0f141a` ≥ 4.5:1, and visually distinct from price-amber `--accent-warm #f0b461` so
  links never read as prices)*.
- Keep the token name `--accent-cool` (rename = churn across ~20 files); only the value
  changes. Document the now-warm value with an inline comment.
- Accept the downstream warming of the two ambient body glows and the city-callout
  border that color-mix `--accent-cool` — both move the palette toward the intended
  aurora/sombrero warmth.

### 3. Wordmark home affordance (`components/site-wordmark.tsx`)

- Prefix the text with a `🍻` glyph (decorative, `aria-hidden`).
- Add an explicit hover underline (in addition to the existing color shift) so it reads
  as interactive at a glance. Keep it a text link to `/`.

### 4. Shared chrome on orphaned content pages

`about`, `faq`, and `for-restaurants` currently render bare `<main>` with no way home
and no cross-links. Give them the same top wordmark + a small footer.

- Reuse `SiteWordmark` at the top of each (matches city/venue/neighborhood pages).
- Extract the landing page's footer (`About · FAQ · For restaurants`) into a shared
  `components/site-footer.tsx`, add a "Home" link, and render it on all three content
  pages **and** the landing page (landing swaps its inline footer for the component — no
  visual change there).
- Footer links use the muted footer style (already muted on landing), not the warm
  accent — they're ambient nav, not in-content links.

### 5. For-restaurants back-link (`app/for-restaurants/page.tsx`)

Replace the hardcoded, city-specific "← Browse Tacoma happy hours" (`/tacoma`, a legacy
redirect — wrong in a multi-city app). With the shared header/footer now providing Home
nav, drop the inline link or make it city-agnostic: "← Back to happy hours" → `/`.
Recommendation: drop the standalone link, rely on the new wordmark/footer.

### 6. FAQ photo callout (`app/faq/page.tsx`)

Emphasize that a photo is basically all that's needed. Revise the "How do I submit a
change?" answer to lead with the photo path, e.g.:

> "A photo of the menu or a happy-hour sign is usually all we need — snap it, add it on
> any venue (a source link helps but isn't required), pass the captcha, and submit. Most
> verified low-risk changes apply within about a day."

The FAQ also inherits the shared header/footer from change #4 (fixes its missing home /
restaurants links). Keep the `faqLd` structured data in sync with the edited answer.

### 7. Floating doodles — more types + ~10% more (`components/ui/floating-doodles.tsx`)

Expand the 5-emoji set to a richer drink/food rotation and bump the count modestly
(operator: "increase amount by ~10%"). Keep it subtle — decorative, low-distraction,
still pure-CSS (no client JS, no randomness; fixed array with staggered negative delays).

- Candidate additions: `🍷 🍹 🍊 🥂 🌮 🧀 🫧` alongside existing `🍋 🫒 🍸 🍻 ✨`.
- Land around 7–9 spans total with varied `left`/`size`/`duration`/`delay`. Final set
  tuned for even horizontal spread *(verify in impl)*.

### 8. (Recovered) Stub-prompt heart tweak (`components/venue-table-client.tsx`)

Operator's in-progress microcopy edit (unwrap + trailing `❤️` on the "more spots we're
still confirming" prompt) was dropped by a dirty-tree branch switch and has been
restored. Already on disk on this branch — included here so it ships in this pass.

## Out of scope (deferred)

- Shared footer on city/venue/neighborhood pages.
- Header city-switcher / "browse other cities" affordance.
- Extra submit/contribute discoverability beyond the FAQ + footer.
- Any OG/social/venue imagery (operator: images are back-burner).

## Testing / acceptance

- `pnpm typecheck` + `pnpm build` green.
- Visual check at 375px (mobile-first) and desktop after `rm -rf .next`: wordmark reads
  clickable; links are warm and consistent; content pages have working Home + nav; copy
  renders without orphaned words; doodles spread evenly and stay subtle.
- FAQ `faqLd` JSON-LD matches the visible answer text.
