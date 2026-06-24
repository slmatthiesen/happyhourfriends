# Anti-scrape: Cloudflare proxy + origin lockdown

Goal: make it expensive for competitors to bulk-copy the venue/HH dataset, **without**
hurting SEO (Google/Bing must crawl freely — that's the growth model). The app-layer
limiter (`proxy.ts` + `lib/trust/pageRateLimit.ts`) is the backstop; **Cloudflare in
front of the droplet is the primary wall** and the only layer that defeats User-Agent
spoofing (it verifies Googlebot et al. by reverse DNS).

Operator-only — this is prod infra on the DigitalOcean droplet, not something the app
deploys.

## Why this matters
Today the origin IP (`137.184.96.46`) is reachable directly on `:443`. Any protection
that lives only at the origin can be bypassed by hitting the IP, and the IP itself is a
fixed target for abuse. Putting CF in front hides the origin and moves enforcement to
the edge.

## Step 1 — Put the site behind Cloudflare (free plan)
1. Add the domain to the same Cloudflare account that issues the Turnstile keys.
2. Point the apex + `www` DNS records at the droplet, **proxied** (orange cloud ON).
3. SSL/TLS mode: **Full (strict)** — keep the valid cert on the droplet.
4. Confirm traffic flows through CF: responses now carry `cf-ray` / `server: cloudflare`
   headers, and `cf-connecting-ip` reaches the origin (the limiter already reads it).

## Step 2 — Lock the origin to Cloudflare only
Once CF serves traffic, stop accepting direct hits to the droplet IP. Either:

- **droplet firewall / `ufw`**: allow `:443` and `:80` only from the published
  [Cloudflare IP ranges](https://www.cloudflare.com/ips/); deny the rest. Keep your SSH
  port open to your own IP.
- **or nginx allowlist** in the server block:
  ```nginx
  # Cloudflare ranges — refresh from https://www.cloudflare.com/ips/
  # (use a generated include; this is illustrative)
  allow 173.245.48.0/20;
  allow 103.21.244.0/22;
  # … all CF v4 + v6 ranges …
  deny all;

  # Restore the real visitor IP from CF so logs + the app see it.
  real_ip_header CF-Connecting-IP;
  set_real_ip_from 173.245.48.0/20;   # repeat per CF range
  ```

After this, `curl https://137.184.96.46` (direct IP) should fail; the domain still works.

## Step 3 — Edge rules (the actual scrape defense)
In **Security → Bots**: enable **Bot Fight Mode** (free). It challenges automated
clients while letting CF-verified search/social bots through — that's the spoof-proof
version of the UA allowlist in `pageRateLimit.ts`.

In **Security → WAF → Rate limiting rules**, add a per-IP read throttle (free plan
allows one rule; tune to taste):

- **Match**: `http.request.uri.path` not starting with `/api` (those have their own
  limits) — e.g. expression `not starts_with(http.request.uri.path, "/api")`.
- **Counting**: by client IP.
- **Rate**: e.g. **100 requests / 10 seconds** (well above human browsing; only bulk
  fetchers hit it).
- **Action**: Managed Challenge (preferred — real users solve it invisibly) or Block
  for a few minutes.
- Verified bots are exempt automatically when Bot Fight Mode is on.

Optional hardening:
- **WAF custom rule**: challenge requests from known datacenter/VPS ASNs
  (`ip.geoip.asnum in {…}`) that aren't verified bots — most scrapers run from cloud
  IPs, real users don't.
- **Block known bad UAs / empty UA** on non-`/api` paths.
- **Scrape Shield** (free): email obfuscation + hotlink protection.

## How the layers compose
| Layer | Stops | Defeats UA spoofing? | Where |
|-------|-------|----------------------|-------|
| CF Bot Fight Mode + WAF rate limit | bulk scrapers, datacenter IPs | **yes** (reverse-DNS verified bots) | edge (you) |
| Origin IP allowlist | direct-to-origin bypass | n/a | droplet (you) |
| `proxy.ts` per-IP limiter | scrapers that still reach origin | no (UA allowlist) | app (shipped) |

The app limiter keeps working even before CF is configured, and stays as defense-in-depth
after. Tune it via env if needed: `PAGE_RATE_LIMIT_PER_MIN` (default 60),
`PAGE_RATE_LIMIT_PER_10MIN` (default 600).

## What this does NOT do
Public HTML you let Google index is, by definition, fetchable. These layers raise the
**cost and convenience** of bulk extraction and give you the legal footing (see
`/terms`) to act on abuse — they don't make the data physically uncopyable. Pair with
the Terms of Service and, if you want court-grade proof of copying, seed a few
watermarked honeytoken venues (ask Claude to build them).
