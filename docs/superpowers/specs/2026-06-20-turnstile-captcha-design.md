# Replace hCaptcha with Cloudflare Turnstile

**Date:** 2026-06-20
**Status:** Approved for implementation

## Motivation

hCaptcha's paid tier costs more than is justifiable for a site intended to make zero
dollars, and the free tier's UX feels poor. Cloudflare Turnstile is free, unlimited, and
mostly invisible (managed challenge — usually no image puzzles). It is structurally
identical to hCaptcha: a script-loaded client widget produces a token, the server verifies
that token against a `siteverify` endpoint.

## Approach: straight replace

No provider-abstraction layer. The code is already abstracted at the right level — two
small files behind a provider-agnostic `captchaToken` field. An interface with a single
implementation would be YAGNI overhead. If we ever swap providers again it is the same
~2-file change. Risk of "lock-in" does not apply.

The only material risk is operational (not architectural): Turnstile must be configured in
production or the submission/flag endpoints fail closed — identical to hCaptcha's current
posture, which we preserve.

## Files changed

### Core (rename + rewrite internals)

- `lib/captcha/hcaptcha.ts` → `lib/captcha/turnstile.ts`
  - Keep exports `verifyCaptcha(token, remoteIp?)` and `isCaptchaEnforced()` with identical
    signatures.
  - Endpoint → `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
  - Secret env → `TURNSTILE_SECRET_KEY`.
  - **Preserve posture exactly:** secret unset + `NODE_ENV==="production"` → return `false`
    (fail closed, log error); secret unset + dev → return `true` (skip); token missing →
    `false`; POST `secret` + `response` (+ `remoteip` when present) as
    `application/x-www-form-urlencoded`; parse `{ success?: boolean }`; network error →
    `false`.

- `components/submit/hcaptcha.tsx` → `components/submit/turnstile.tsx`
  - Component `HCaptcha` → `Turnstile`, same `{ onToken: (token: string | null) => void }`
    prop.
  - Script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`.
  - `window.turnstile.render(el, { sitekey, theme: "dark", callback, "expired-callback",
    "error-callback" })`; expired/error → `onToken(null)`.
  - Site-key env → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; when unset, render the same
    "captcha disabled in this environment" note and emit a null token.
  - Keep the single-render guard and lazy script-load promise pattern from the current file.

### Consumers (import + symbol rename only — no logic change)

- `app/api/flags/route.ts` — import path `@/lib/captcha/turnstile` (call site unchanged).
- `app/api/submissions/route.ts` — same.
- `components/flag/flag-widget.tsx` — import `Turnstile`, use `<Turnstile … />`.
- `components/submit/report-change.tsx` — same.
- `components/submit/contribute.tsx` — same.
- `components/submit/submission-form.tsx` — same.

### Unchanged on purpose

- Form payload field stays `captchaToken` (provider-agnostic) → `lib/submit/payload.ts` and
  the API body parsers need no change.
- Rate-limiting, honeypot, and trust logic untouched.

### Docs / config

- `.env.example` — replace the hCaptcha block with `NEXT_PUBLIC_TURNSTILE_SITE_KEY` /
  `TURNSTILE_SECRET_KEY`, and note Cloudflare's always-pass test keys for local dev:
  site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
- `README.md` — env table + submission-flow line: hCaptcha → Turnstile.
- `GO_LIVE.md` — pre-launch checklist env var name.
- `SECURITY.md` — self-hoster note env var name.
- `PRD.md` — captcha references (provider table, env block, setup steps, links).

## Testing

- Unit-test `verifyCaptcha` against the new endpoint by mocking `fetch`: success token →
  `true`; failure response → `false`; missing token → `false`; unset secret in prod →
  `false`; unset secret in dev → `true`; network throw → `false`. Mirror any existing
  hCaptcha verify test; if none exists, add this one.
- Manual: run locally with the always-pass test keys, exercise the submission, report-change,
  contribute, and flag forms; confirm token posts and `siteverify` returns success.

## Out of scope

- Provider abstraction / factory.
- Any change to the moderation pipeline, rate limits, or trust matrix.
