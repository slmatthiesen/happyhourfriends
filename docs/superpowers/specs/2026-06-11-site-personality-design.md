# Site personality round — design

**Date:** 2026-06-11 · **Branch:** `chore/whats-next-brainstorm` (implementation gets its own branch)
**Goals served:** personality & delight, engagement & community, growth (operator-ranked 2026-06-11)

## Review posture (overrides merge-when-green for this work)

This round is **built on a feature branch and NOT merged to main right away**. The
operator wants a live review period on the branch first. Independently of that, every
feature below must be **easily toggleable and cheap to remove**: one switch flipped or
one component deleted, no tendrils.

Toggle mechanism: `lib/ui/flags.ts` exporting a plain const object, e.g.
`export const uiFlags = { aurora: true, doodles: true, copyLink: true } as const;`
No env plumbing, no runtime config — flipping a boolean and rebuilding is the contract.
Microcopy is exempt (plain text edits are trivially revertable).

## 1. Aurora background (site-wide)

Replace the two static radial gradients on `body` in `app/globals.css` with an
animated aurora mesh:

- A fixed, full-viewport layer (extends ~40% beyond edges) carrying three radial
  gradients in the Slate accents — amber `rgba(240,180,97,.18)`, blue
  `rgba(107,158,232,.16)`, pink `rgba(224,112,138,.10)` — rotating ~12° and scaling
  to ~1.2 over ~16s, `ease-in-out infinite alternate`.
- Grain overlay (`body::before`) unchanged.
- Pure CSS; animates `transform` only; **no blur filters on animated layers**.
- `prefers-reduced-motion: reduce` → animation off, layer freezes as a static gradient
  (still prettier than flat).
- Toggle: gated by `uiFlags.aurora`; off → restore current static gradients (kept in
  the CSS as the fallback branch).

Chosen from 4 prototyped options (drifting glows / doodles / aurora / time-aware
golden hour) via visual companion; operator picked aurora as base.

## 2. Floating doodles (site-wide)

- One decorative server component (e.g. `components/ui/floating-doodles.tsx`) mounted
  once in `app/layout.tsx`, rendering ~5 emoji spans: 🍋 🫒 🍸 🍻 ✨.
- Low opacity (0.35–0.45), staggered 13–20s upward-drift CSS loops, slight rotation.
- `pointer-events: none`, `aria-hidden="true"`, z-index behind all content.
- `prefers-reduced-motion: reduce` → hidden entirely.
- Toggle: `uiFlags.doodles` short-circuits the component to `null`; removal = delete
  the component + one line in `layout.tsx`.

## 3. About page "Me" section

New section at the bottom of `app/about/page.tsx`:

- **Letter-style first person** ("Hey — I'm Steven."). No signature block, **no last
  name**, no contact links.
- Content: built a site like this ~10 years ago just for Phoenix and people loved it;
  this site exists to prove a community can help each other find good deals.
- **Sombrero photo** (operator having fun), rounded, via `next/image`, beside or above
  the text. Operator supplies the file; placeholder until then.
- Copy drafted by Claude, edited by operator before merge.
- Removal = delete the section JSX (self-contained).

## 4. Microcopy pass

Voice: warm, lightly bar-flavored, clarity always wins. Spots:

- Venue table empty / filtered-to-zero state
- Stub "help us fill this in" prompt
- Loading states (where any exist)
- `app/not-found.tsx` — proper 404 ("This page is past last call" energy)
- One footer line with voice

Full inventory happens during planning; **all copy lands in one reviewable list before
implementation**. Plain text edits — no toggle needed.

## 5. Copy-link button on venue pages

- Small "Copy link" button (clipboard icon, shadcn styling) on the venue detail page.
- Client component: `navigator.clipboard.writeText(canonicalUrl)` → brief "Copied"
  check-state (~2s). Canonical URL passed from the server page (no `window.location`
  dependence, keeps it correct behind any proxy).
- Nothing beyond copy: no share sheets, no preformatted text, no row-level buttons.
- Toggle: `uiFlags.copyLink`; removal = delete component + one mount line.

## Explicitly out / deferred

- **Browser AI (Chrome built-in / Gemini Nano):** dropped — no user-visible win over
  the existing server pipeline.
- **One-click "still accurate?" confirm / thumbs up-down on venues:** operator likes
  the idea, **not building yet** — future candidate.
- **Community pulse counter** ("12 neighbors confirmed this week"): deferred.
- **Dynamic OG share images:** skipped — current previews good enough for now.

## Testing & acceptance

- `pnpm typecheck` and `pnpm build` green.
- Manual visual pass: aurora + doodles on landing, city table, venue page; verify
  table readability; verify `prefers-reduced-motion` kills all motion.
- Copy-link: click → clipboard contains canonical URL → "Copied" state shows and
  reverts.
- Each `uiFlags` boolean flipped off individually → feature disappears cleanly,
  build stays green.
