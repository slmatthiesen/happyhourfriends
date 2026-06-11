# Site Personality Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aurora animated background + floating doodles site-wide, an About-page "Me" section, a microcopy pass, and a copy-link button on venue pages — every feature behind a one-line kill switch.

**Architecture:** All toggles live in one plain const object (`lib/ui/flags.ts`); CSS-only animation gated by a body class set in `app/layout.tsx`; decorative and interactive pieces are self-contained components mounted with one line each. Spec: `docs/superpowers/specs/2026-06-11-site-personality-design.md`.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind 4 design tokens in `app/globals.css`, TypeScript strict.

**Review posture:** This branch does **NOT** merge to main when green. The operator reviews on-branch first (their explicit instruction 2026-06-11; overrides merge-when-green).

**Testing note:** This repo's test convention is `tsx scripts/test-*.ts` for pure logic. Every change here is presentational (CSS/JSX) with no extractable logic, so the acceptance gates are `pnpm typecheck`, `pnpm build`, and the manual checklist in Task 7 — no component test harness exists and adding one is out of scope (YAGNI).

---

### Task 0: Branch

This work continues on the existing brainstorm branch (it already carries the spec; spec + implementation are one unit of work). Rename it to match the content:

- [ ] **Step 1: Rename branch and sync**

```bash
git branch -m chore/whats-next-brainstorm feat/site-personality
git fetch origin && git rev-list --count HEAD..origin/main
```

Expected: rename succeeds; count is 0 or small (if main moved, rebase: `git rebase origin/main`).

---

### Task 1: UI flags

**Files:**
- Create: `lib/ui/flags.ts`

- [ ] **Step 1: Write the flags module**

```ts
/* Kill switches for the personality round (2026-06-11). Each feature must
   disappear cleanly when its flag is false — the operator wants this round
   easy to disable while reviewing on-branch.
   Spec: docs/superpowers/specs/2026-06-11-site-personality-design.md */
export const uiFlags = {
  aurora: true,
  doodles: true,
  copyLink: true,
} as const;
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/ui/flags.ts && git commit -m "feat(ui): add uiFlags kill switches for personality round"
```

---

### Task 2: Aurora background

**Files:**
- Modify: `app/globals.css` (body background block is lines 88–107; grain overlay `body::before` is 110–118 — leave both in place)
- Modify: `app/layout.tsx:34` (body className)

- [ ] **Step 1: Add aurora CSS to `app/globals.css`** (append after the `body::before` grain block). The static gradients on `body` stay as the flag-off fallback; `.aurora-on` overrides them.

```css
/* ── Aurora mesh background (personality round) ─────────────────────────────
   Animated replacement for the static glows, gated by .aurora-on on <body>
   (set from uiFlags.aurora in app/layout.tsx — flag off restores the static
   gradients above). transform-only animation; no blur filters (perf). */
body.aurora-on {
  background-image: none;
}
body.aurora-on::after {
  content: "";
  position: fixed;
  inset: -40%;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(
      40% 40% at 30% 30%,
      color-mix(in oklab, var(--accent-warm) 18%, transparent),
      transparent 70%
    ),
    radial-gradient(
      35% 35% at 70% 40%,
      color-mix(in oklab, var(--accent-cool) 16%, transparent),
      transparent 70%
    ),
    radial-gradient(
      30% 30% at 50% 70%,
      color-mix(in oklab, var(--accent-hot) 10%, transparent),
      transparent 70%
    );
  animation: aurora-drift 16s ease-in-out infinite alternate;
}
@keyframes aurora-drift {
  from {
    transform: rotate(0deg) scale(1);
  }
  to {
    transform: rotate(12deg) scale(1.2);
  }
}
@media (prefers-reduced-motion: reduce) {
  body.aurora-on::after {
    animation: none; /* freezes as a static mesh — still layered, no motion */
  }
}
```

- [ ] **Step 2: Gate via body class in `app/layout.tsx`**

Add the import and change the `<body>` line:

```tsx
import { uiFlags } from "@/lib/ui/flags";
```

```tsx
<body
  className={cn("min-h-full flex flex-col", uiFlags.aurora && "aurora-on")}
>
```

- [ ] **Step 3: Verify visually**

Run: `rm -rf .next && pnpm dev` → open the landing page and a city page (mind the port — dev bumps to :3001 if :3000 is taken).
Expected: slow amber/blue/pink color drift behind content; grain still present; table rows fully readable. Flip `aurora: false` in `lib/ui/flags.ts`, reload → original static glows return. Flip back to `true`.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat(ui): animated aurora mesh background behind uiFlags.aurora"
```

---

### Task 3: Floating doodles

**Files:**
- Create: `components/ui/floating-doodles.tsx`
- Modify: `app/globals.css` (append)
- Modify: `app/layout.tsx` (mount)

- [ ] **Step 1: Write the component**

```tsx
import { uiFlags } from "@/lib/ui/flags";

/* Decorative emoji drifting up behind all content (personality round).
   Pure CSS animation, no client JS. Negative delays stagger the loop so the
   field looks mid-flight on load instead of launching in formation. */
const DOODLES = [
  { emoji: "🍋", left: "8%", duration: "14s", delay: "0s", size: "22px" },
  { emoji: "🫒", left: "30%", duration: "18s", delay: "-7s", size: "20px" },
  { emoji: "🍸", left: "55%", duration: "16s", delay: "-11s", size: "24px" },
  { emoji: "🍻", left: "80%", duration: "20s", delay: "-4s", size: "24px" },
  { emoji: "✨", left: "92%", duration: "12s", delay: "-8s", size: "14px" },
];

export function FloatingDoodles() {
  if (!uiFlags.doodles) return null;
  return (
    <div className="doodle-field" aria-hidden="true">
      {DOODLES.map((d) => (
        <span
          key={d.emoji}
          style={{
            left: d.left,
            fontSize: d.size,
            animationDuration: d.duration,
            animationDelay: d.delay,
          }}
        >
          {d.emoji}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Append doodle CSS to `app/globals.css`**

```css
/* ── Floating doodles (personality round) ───────────────────────────────────
   Rendered by components/ui/floating-doodles.tsx; uiFlags.doodles kills it. */
.doodle-field {
  position: fixed;
  inset: 0;
  z-index: -1; /* above the aurora (-2), behind all content */
  pointer-events: none;
  overflow: hidden;
}
.doodle-field span {
  position: absolute;
  bottom: -40px;
  opacity: 0.4;
  animation: doodle-float linear infinite;
}
@keyframes doodle-float {
  from {
    transform: translateY(0) rotate(0deg);
  }
  to {
    transform: translateY(calc(-100vh - 80px)) rotate(25deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .doodle-field {
    display: none;
  }
}
```

- [ ] **Step 3: Mount in `app/layout.tsx`** (inside `<body>`, before the provider)

```tsx
import { FloatingDoodles } from "@/components/ui/floating-doodles";
```

```tsx
<body
  className={cn("min-h-full flex flex-col", uiFlags.aurora && "aurora-on")}
>
  <FloatingDoodles />
  <PostHogProvider>{children}</PostHogProvider>
</body>
```

- [ ] **Step 4: Verify visually**

Reload dev. Expected: five faint emoji drifting upward at different speeds, never intercepting clicks (try clicking a venue row "through" one); macOS System Settings → Accessibility → Display → Reduce Motion hides them and freezes the aurora. Flip `doodles: false` → gone.

- [ ] **Step 5: Commit**

```bash
git add components/ui/floating-doodles.tsx app/globals.css app/layout.tsx
git commit -m "feat(ui): floating bar doodles behind uiFlags.doodles"
```

---

### Task 4: About page "Me" section

**Files:**
- Modify: `app/about/page.tsx` (append a section before `</main>`, currently line 43)

- [ ] **Step 1: Add the section.** Letter style, first name only, **no signature**, no contact links. Photo is a placeholder block until the operator supplies the sombrero photo (swap note in comment).

```tsx
      <section className="mt-14 border-t border-border pt-10">
        <h2
          className="text-2xl font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Hey — I&apos;m Steven 👋
        </h2>
        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
          {/* Swap for <Image src="/about/me-sombrero.jpg" alt="Steven in a sombrero, having a great time" width={160} height={160} className="rounded-xl object-cover" /> once the photo lands in public/about/. */}
          <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-elevated text-6xl">
            🤠
          </div>
          <div className="space-y-4 text-text-muted">
            <p>
              About ten years ago I built a site a lot like this one, just for
              Phoenix. No ads, no gimmicks — every happy hour in town in one big
              list. People loved it, and I never stopped thinking about why:
              nobody wants to dig through ten menus to find the $5 margarita.
              Friends just tell each other.
            </p>
            <p>
              That&apos;s the bet behind Happy Hour Friends: a community that
              keeps each other in the loop will always find better deals than
              any ad budget. The data starts with us, but it gets good with you
              — if you spot a deal we&apos;re missing or a price that&apos;s
              changed, send it in. That&apos;s the whole idea.
            </p>
          </div>
        </div>
      </section>
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`; reload `/about`.
Expected: section renders below existing content, placeholder tile beside the letter on ≥sm widths, stacked on mobile.

- [ ] **Step 3: Commit**

```bash
git add app/about/page.tsx
git commit -m "feat(about): add personal letter section with Phoenix origin story"
```

---

### Task 5: Microcopy pass

**Files:**
- Create: `app/not-found.tsx`
- Modify: `components/venue-table-client.tsx:583-586` (empty state)
- Modify: `app/page.tsx:44-54` (footer)
- Modify: `app/[state]/[city]/page.tsx:114` (stub banner — review only)

No `loading.tsx` routes exist in the app — loading copy is out of scope.

**The copy list (operator reviews this table; plain text, no flags needed):**

| Spot | Current | New |
|---|---|---|
| Table empty state, line 1 | "No venues listed yet." | "Nothing on the tap list yet." |
| Table empty state, line 2 | "We add venues only with a verifiable source — no guesses." | "We only list what we can verify — no guesses, no stale specials." |
| 404 page | *(none — default Next 404)* | "Past last call" / "This page doesn't exist — or it closed up and moved without telling us." |
| Landing footer | *(links only)* | Add line above links: "Built by a friend who hates paying full price." |
| City stub banner | "We're still gathering happy hours here — help us fill it in." | **Keep** — already has voice. No change. |

- [ ] **Step 1: Create `app/not-found.tsx`**

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-24 text-center">
      <p className="text-6xl">🍸</p>
      <h1
        className="mt-6 text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Past last call
      </h1>
      <p className="mt-4 text-text-muted">
        This page doesn&apos;t exist — or it closed up and moved without telling
        us.
      </p>
      <Link
        href="/"
        className="mt-8 text-sm font-medium text-accent-cool hover:underline"
      >
        ← Back to the happy hours
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: Update the table empty state** in `components/venue-table-client.tsx` (lines 583–586):

```tsx
        <p className="text-lg text-text-primary">Nothing on the tap list yet.</p>
        <p className="mt-2 text-text-muted">
          We only list what we can verify — no guesses, no stale specials.
        </p>
```

- [ ] **Step 3: Add the footer line** in `app/page.tsx`, immediately above the `<footer>` (line 44):

```tsx
      <p className="mt-16 text-center text-sm text-text-muted/80">
        Built by a friend who hates paying full price.
      </p>
      <footer className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-text-muted">
```

(Note `mt-16` moves from the footer to the new line; footer drops to `mt-4`.)

- [ ] **Step 4: Verify**

Run: `pnpm typecheck`; visit `/`, a city page with filters that match nothing, and `/this-does-not-exist`.
Expected: new copy everywhere; 404 renders the cocktail page (with aurora behind it).

- [ ] **Step 5: Commit**

```bash
git add app/not-found.tsx components/venue-table-client.tsx app/page.tsx
git commit -m "feat(copy): microcopy pass — 404 page, empty state, footer voice line"
```

---

### Task 6: Copy-link button on venue pages

**Files:**
- Create: `components/copy-link-button.tsx`
- Modify: `app/[state]/[city]/venue/[slug]/page.tsx` (action row, around line 205 — sibling of `<DirectionsButton>`)

- [ ] **Step 1: Write the component.** Match the `DirectionsButton` idiom exactly (plain accent link + 16px stroke icon — see `components/directions-button.tsx`).

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

/* Copy-the-canonical-URL share action (personality round). Deliberately just
   clipboard — no share sheets, no preformatted text (operator decision
   2026-06-11). URL is passed from the server page so it's the canonical
   absolute URL, not window.location behind a proxy. */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions / non-secure context) — stay quiet.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-cool hover:underline"
    >
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
```

- [ ] **Step 2: Mount on the venue page.** In `app/[state]/[city]/venue/[slug]/page.tsx`, the metadata already computes `alternates: { canonical: venuePath(c.state, c.slug, v.slug) }` (line 39). In the page component, build the absolute URL the same way the layout does and render next to `DirectionsButton` (line ~205):

```tsx
import { CopyLinkButton } from "@/components/copy-link-button";
import { uiFlags } from "@/lib/ui/flags";
```

```tsx
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
```

```tsx
{venue.address && <DirectionsButton address={venue.address} />}
{uiFlags.copyLink && (
  <CopyLinkButton
    url={new URL(venuePath(city.state, city.slug, venue.slug), SITE_URL).toString()}
  />
)}
```

**Adapt the variable names to what the page component actually uses** (read the surrounding code — the metadata function uses `c`/`v`, the page body may differ). `venuePath` is already imported for metadata; if it's only imported in `generateMetadata`'s scope, hoist the import.

- [ ] **Step 3: Verify**

Reload a venue page. Expected: "Copy link" sits beside "Directions" in matching style; click → button flips to "✓ Copied" for 2s; paste gives the absolute canonical URL. Flip `copyLink: false` → button gone.

- [ ] **Step 4: Commit**

```bash
git add components/copy-link-button.tsx "app/[state]/[city]/venue/[slug]/page.tsx"
git commit -m "feat(venue): copy-link button behind uiFlags.copyLink"
```

---

### Task 7: Acceptance gate

- [ ] **Step 1: Full gates**

```bash
pnpm typecheck && pnpm build
```

Expected: both green.

- [ ] **Step 2: Flag-flip matrix.** For each of `aurora`, `doodles`, `copyLink`: set it `false` in `lib/ui/flags.ts`, run `pnpm typecheck`, confirm in dev that only that feature disappears, set back to `true`. (One at a time.)

- [ ] **Step 3: Manual visual checklist**

- Landing, city table, venue page, `/about`, 404: aurora + doodles present, content readable.
- Reduce Motion on: no motion anywhere, doodles hidden.
- Copy-link works; clicking "through" a doodle works.

- [ ] **Step 4: Push branch — do NOT merge**

```bash
git push -u origin feat/site-personality
```

Open a draft PR if desired (`gh pr create --draft`), but per the operator's instruction this round stays on the branch for a live review period. **Do not `gh pr merge`.**

---

## Operator inputs still owed

1. **Sombrero photo** → drop at `public/about/me-sombrero.jpg`, then swap the 🤠 placeholder per the comment in Task 4.
2. **Copy review** — the Task 5 table and the Task 4 letter are drafts for the operator to edit.
