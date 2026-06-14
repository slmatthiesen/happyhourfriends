# UX/UI Review Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the public reading surface — friendlier landing copy, a warm/consistent link accent, a clickable wordmark, shared chrome on orphaned content pages, a FAQ photo callout, and a richer doodle field.

**Architecture:** Pure presentational changes. One new shared `SiteFooter` component (extracted from the landing footer, gains a Home link) reused across landing + content pages; `SiteWordmark` gains a glyph + hover affordance; one design-token value warms every link at once; the rest are copy/markup edits. No new features, no data/logic changes.

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, Tailwind 4 (design tokens in `app/globals.css`), TypeScript strict.

**Verification model:** This repo has no component/presentational tests (its suite is pure-logic `node:test` via `scripts/ci-tests.sh`). Per-task gate = `pnpm typecheck`. Final gate = `pnpm build` + a Playwright visual check at 375px and desktop after `rm -rf .next`. Commit after every task.

---

## File Structure

- **Create:** `components/site-footer.tsx` — shared footer nav (Home · About · FAQ · For restaurants).
- **Modify:** `components/site-wordmark.tsx` — add `🍻` glyph + hover underline.
- **Modify:** `app/globals.css:14` — warm the `--accent-cool` token value.
- **Modify:** `app/page.tsx` — landing copy + metadata + use `SiteFooter`.
- **Modify:** `app/about/page.tsx`, `app/faq/page.tsx`, `app/for-restaurants/page.tsx` — add wordmark + footer chrome; FAQ photo callout; drop hardcoded Tacoma link.
- **Modify:** `components/ui/floating-doodles.tsx` — expand the emoji set.
- **Already on disk (recovered):** `components/venue-table-client.tsx` — operator's `❤️` microcopy tweak (Task 1 just commits it).

---

### Task 1: Commit the recovered microcopy tweak

The operator's `❤️` edit on the stub prompt was restored to disk during brainstorming but is uncommitted. Lock it in first so it can't be lost again.

**Files:**
- Modify (already edited): `components/venue-table-client.tsx:1096`

- [ ] **Step 1: Confirm the edit is present**

Run: `grep -n "Help us add it ❤️" components/venue-table-client.tsx`
Expected: one match around line 1096.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/venue-table-client.tsx
git commit -m "feat(ui): unwrap stub prompt + add heart (recovered operator tweak)"
```

---

### Task 2: Create the shared `SiteFooter`

**Files:**
- Create: `components/site-footer.tsx`

- [ ] **Step 1: Write the component**

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Shared footer nav. Reused on the landing page and the standalone content pages
 * (about / faq / for-restaurants) so every page has a way home and to its siblings.
 * Muted "ambient nav" style — deliberately NOT the warm in-content link accent.
 */
const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/for-restaurants", label: "For restaurants" },
];

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-text-muted",
        className,
      )}
    >
      {FOOTER_LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="hover:text-text-primary">
          {l.label}
        </Link>
      ))}
    </footer>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (component is unused so far — that's fine; it gets wired in Tasks 5–6).

- [ ] **Step 3: Commit**

```bash
git add components/site-footer.tsx
git commit -m "feat(ui): shared SiteFooter nav component"
```

---

### Task 3: Wordmark glyph + hover affordance

**Files:**
- Modify: `components/site-wordmark.tsx`

- [ ] **Step 1: Replace the component body**

Replace the existing `<Link>...</Link>` return with the version below (adds an `aria-hidden` `🍻` glyph and `hover:underline`):

```tsx
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium text-text-muted underline-offset-4 transition-colors hover:text-text-primary hover:underline",
        className,
      )}
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <span aria-hidden="true">🍻</span>
      Happy Hour Friends
    </Link>
  );
```

(Note: `inline-block` → `inline-flex items-center gap-1.5` so the glyph and text align.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/site-wordmark.tsx
git commit -m "feat(ui): wordmark glyph + hover underline so it reads clickable"
```

---

### Task 4: Warm the link accent token

**Files:**
- Modify: `app/globals.css:14`

- [ ] **Step 1: Repoint the token**

Replace:

```css
  --accent-cool: #6b9ee8; /* links, secondary actions */
```

with:

```css
  --accent-cool: #d98a5c; /* warm clay — links + secondary actions (was cool blue #6b9ee8) */
```

This warms every link/secondary action sitewide in one place (the token's declared role). The two ambient body glows and the city-callout border that `color-mix` this token warm too — intended, toward the aurora/sombrero palette.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Visual contrast check (manual)**

After the dev server is up (Task 9 covers full QA), confirm `#d98a5c` reads clearly on `--bg-deep #0f141a` (target ≥ 4.5:1) and is visibly distinct from price-amber `--accent-warm #f0b461` so a link never looks like a price. If it reads too close to amber or too dim, nudge toward a redder clay (e.g. `#d97f55`) and re-check. Record the final value in the commit message.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(ui): warm the link accent (cool blue -> clay)"
```

---

### Task 5: Landing page copy + metadata + footer

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update the metadata description**

Replace lines 13–14:

```ts
  description:
    "The simplest happy hour site around. Just the data you want: sort it, filter it, find your spot. If something's off, help fix it — we all help each other out here.",
```

with:

```ts
  description:
    "The simplest happy hour site around. Just the data you want: sort it, filter it, find your spot. Snap a pic to add a spot or fix a deal — we keep each other in the loop.",
```

- [ ] **Step 2: Update the body copy + picker lead**

Replace the two paragraphs (current lines 33–39):

```tsx
      <p className="mt-6 max-w-xl text-balance text-lg text-text-muted">
        Just the data you want — none of the fluff, no extra pages. Sort it,
        filter it, find your spot. And when something&apos;s off, fix it.
      </p>
      <p className="mt-3 text-lg font-medium text-text-primary">
        Come in, find a place to eat and drink.
      </p>
```

with:

```tsx
      <p className="mt-6 max-w-xl text-balance text-lg text-text-muted">
        Just the data you want — none of the fluff, no extra pages. Sort it,
        filter it, find your spot. Snap a pic to add a spot or fix a deal — we
        keep each other in the loop.
      </p>
      <p className="mt-3 text-lg font-medium text-text-primary">
        Find your spot:
      </p>
```

- [ ] **Step 3: Swap the inline footer for `SiteFooter`**

Add the import near the top (with the other component imports):

```tsx
import { SiteFooter } from "@/components/site-footer";
```

Replace the inline `<footer>...</footer>` block (current lines 52–62) with:

```tsx
      <SiteFooter className="mt-4" />
```

Keep the `<p className="mt-16 ...">Built by a friend who loves trying new places.</p>` tagline above it unchanged.

The inline footer was the only use of `Link` in this file, so remove its now-unused import (line 2):

```tsx
import Link from "next/link";
```

(`CityPicker` and `SiteFooter` handle their own links.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors (lint flags a leftover unused `Link` import if Step 3 missed it).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): friendlier landing copy + shared footer"
```

---

### Task 6: Content-page chrome (about / for-restaurants) + drop Tacoma link

**Files:**
- Modify: `app/about/page.tsx`
- Modify: `app/for-restaurants/page.tsx`

- [ ] **Step 1: Add chrome to About**

In `app/about/page.tsx`, add imports:

```tsx
import { SiteWordmark } from "@/components/site-wordmark";
import { SiteFooter } from "@/components/site-footer";
```

Make the wordmark the first child of `<main>` (immediately after the opening `<main ...>` tag):

```tsx
      <SiteWordmark className="mb-8" />
```

Add the footer as the last child of `<main>` (immediately before the closing `</main>` tag):

```tsx
      <SiteFooter className="mt-14 border-t border-border pt-8" />
```

- [ ] **Step 2: Add chrome to For-restaurants AND drop the hardcoded Tacoma link**

In `app/for-restaurants/page.tsx`, add the same two imports:

```tsx
import { SiteWordmark } from "@/components/site-wordmark";
import { SiteFooter } from "@/components/site-footer";
```

(`Link` is already imported.) Add the wordmark as the first child of `<main>`:

```tsx
      <SiteWordmark className="mb-8" />
```

Delete the hardcoded back-link block (current lines 37–41):

```tsx
        <p>
          <Link href="/tacoma" className="text-accent-cool hover:underline">
            ← Browse Tacoma happy hours
          </Link>
        </p>
```

If `Link` is now unused, remove its import to satisfy lint. Add the footer as the last child of `<main>`:

```tsx
      <SiteFooter className="mt-14 border-t border-border pt-8" />
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors (lint catches an unused `Link` import if the for-restaurants delete left one).

- [ ] **Step 4: Commit**

```bash
git add app/about/page.tsx app/for-restaurants/page.tsx
git commit -m "feat(ui): home/footer chrome on about + for-restaurants; drop hardcoded Tacoma link"
```

---

### Task 7: FAQ chrome + photo callout

**Files:**
- Modify: `app/faq/page.tsx`

- [ ] **Step 1: Rewrite the "How do I submit a change?" answer**

Replace the `a` string of the second FAQ entry:

```ts
    a: "Click the edit prompt on any venue, fill in the corrected value (and a source link if you have one), pass the captcha, and submit. Most verified low-risk changes apply within about a day.",
```

with (leads with the photo path — a photo is basically all you need):

```ts
    a: "A photo of the menu or a happy-hour sign is usually all we need. Snap it, add it on any venue (a source link helps but isn't required), pass the captcha, and submit. Most verified low-risk changes apply within about a day.",
```

The `faqLd` structured data is built from this same `faqs` array, so it stays in sync automatically — no separate edit needed.

- [ ] **Step 2: Add chrome to FAQ**

Add imports:

```tsx
import { SiteWordmark } from "@/components/site-wordmark";
import { SiteFooter } from "@/components/site-footer";
```

Add the wordmark as the first child of `<main>` (after the opening `<main ...>` tag, before the JSON-LD `<script>` is fine too — put it right after `<main>`):

```tsx
      <SiteWordmark className="mb-8" />
```

Add the footer as the last child of `<main>`:

```tsx
      <SiteFooter className="mt-14 border-t border-border pt-8" />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/faq/page.tsx
git commit -m "feat(ui): FAQ photo callout + home/footer chrome"
```

---

### Task 8: Expand the floating doodles

**Files:**
- Modify: `components/ui/floating-doodles.tsx`

- [ ] **Step 1: Replace the `DOODLES` array**

Replace the 5-entry array with this 8-entry set (more drink/food types, even horizontal spread, staggered negative delays):

```tsx
const DOODLES = [
  { emoji: "🍋", left: "6%", duration: "14s", delay: "0s", size: "22px" },
  { emoji: "🍹", left: "18%", duration: "17s", delay: "-9s", size: "22px" },
  { emoji: "🫒", left: "30%", duration: "18s", delay: "-7s", size: "20px" },
  { emoji: "🍊", left: "42%", duration: "15s", delay: "-3s", size: "20px" },
  { emoji: "🍸", left: "55%", duration: "16s", delay: "-11s", size: "24px" },
  { emoji: "🥂", left: "68%", duration: "19s", delay: "-5s", size: "22px" },
  { emoji: "🍻", left: "80%", duration: "20s", delay: "-4s", size: "24px" },
  { emoji: "✨", left: "92%", duration: "12s", delay: "-8s", size: "14px" },
];
```

- [ ] **Step 2: Make the map key index-based**

Change the map callback signature and key so duplicate emojis would still be safe:

Replace:

```tsx
      {DOODLES.map((d) => (
        <span
          key={d.emoji}
```

with:

```tsx
      {DOODLES.map((d, i) => (
        <span
          key={i}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/floating-doodles.tsx
git commit -m "feat(ui): richer floating-doodle set"
```

---

### Task 9: Final build + visual QA

**Files:** none (verification only).

- [ ] **Step 1: Clean build**

Run: `rm -rf .next && pnpm build`
Expected: build succeeds with no type/lint errors.

- [ ] **Step 2: Start dev and visually verify**

Run: `rm -rf .next && pnpm dev` (note the actual port — it bumps to 3001 if 3000 is taken).

Check at **375px (mobile-first)** and desktop:
- Landing: new copy renders with no orphaned/widowed words; "Find your spot:" sits above the picker; footer shows Home · About · FAQ · For restaurants.
- Wordmark (any city/venue page + content pages): shows `🍻`, underlines on hover, links home.
- Links (`← All {city}`, etc.) are warm clay, readable, and distinct from price-amber.
- About / FAQ / For-restaurants: have the top wordmark and bottom footer; no leftover Tacoma link on for-restaurants.
- FAQ: "How do I submit a change?" leads with the photo line.
- Doodles: ~8 emojis, evenly spread, subtle (not distracting).

- [ ] **Step 3: Self-review the diff**

Run: `git diff main...HEAD --stat`
Confirm only the intended files changed; nothing stray.

---

## Out of scope (deferred — do not implement)

- Shared footer on city/venue/neighborhood pages.
- Header city-switcher / "browse other cities" affordance.
- Extra submit/contribute discoverability beyond the FAQ + footer.
- OG/social/venue imagery.
