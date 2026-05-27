# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately through GitHub's **[Report a vulnerability](../../security/advisories/new)**
(Security → Advisories) or by email to **security@happyhourfriends.com**. Include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- affected routes/files and any relevant configuration.

We aim to acknowledge a report within **72 hours** and to provide a remediation
timeline after triage. Please give us a reasonable window to fix the issue before any
public disclosure. Good-faith research is welcome; please avoid privacy violations,
data destruction, and service degradation while testing.

## Scope & known trust boundaries

This is an anonymous-submission product, so the threat model centers on untrusted input.
A few things are worth knowing before you report:

- **User uploads** (menu photos / PDFs) are accepted anonymously. Images are re-encoded
  server-side (metadata stripped); PDFs are magic-byte validated and served with
  `nosniff` + a sandbox CSP + attachment disposition. Reports of bypasses here are
  high value.
- **Client-supplied `x-forwarded-for`** is trusted for rate-limiting and bans. This is
  only safe when the app runs behind a proxy (Cloudflare / load balancer) that
  overwrites the header. A misconfigured deployment that exposes the app directly is a
  *deployment* issue, but report it if the code makes that mistake easy.
- **Spam/abuse controls** (captcha, honeypot, rate limits) — captcha fails **closed** in
  production when unconfigured. Gaps in the rate-limit matrix are in scope.
- **The apply engine** is the only sanctioned write path; every applied change is audited
  and revertible. Any way to write data that bypasses it is in scope.

## Out of scope

- Vulnerabilities requiring a compromised admin account or server access.
- Issues that only affect a deployment misconfiguration explicitly warned against in the
  docs (e.g. running without `HCAPTCHA_SECRET_KEY`, or exposing the app without a proxy).
- Findings in third-party dependencies without a demonstrated impact here (please report
  those upstream).

## Secrets

If you believe a secret has been committed to this repository, report it privately as
above — **do not** post the value in an issue or PR.
