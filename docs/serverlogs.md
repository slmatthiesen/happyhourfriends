# Server logs & error observability

Where the app's logs and errors live, in **prod** and **local dev**, and how to watch
them. Captured 2026-06-20.

## TL;DR

| Environment | Where logs go | How to watch | Error capture / alerting |
|-------------|---------------|--------------|--------------------------|
| **Prod** (droplet) | systemd journal (`happyhourfriends` unit) | `journalctl -u happyhourfriends -f` over SSH | Sentry — **only if `SENTRY_DSN` is set** in prod `.env` |
| **Local dev** | the terminal running `pnpm dev` (stdout/stderr) | watch that terminal, or pipe to a file with `tee` | Sentry is **off locally** (no `SENTRY_DSN`) |

## Prod (DigitalOcean droplet)

- Self-hosted DO droplet. App runs under **systemd unit `happyhourfriends`**, app dir
  `/home/happyhourfriends`. SSH in as `root` (commands take a `PROD_IP`).
- **All app output** — Next.js request errors, `console.error`, and the pg-boss job
  workers (classify/verify/interpret/reextract) — streams to the **systemd journal**.
- **Note:** operator handles all prod access/deploys. Claude does NOT SSH to the droplet.
  To get prod logs into a Claude session, run the SSH command yourself with a leading
  `! ` and the output lands in chat for Claude to interpret.

### Watching prod logs (run these yourself over SSH)

```bash
# Follow live
ssh root@PROD_IP journalctl -u happyhourfriends -f

# Recent errors only (last 200 lines, priority=error and worse)
ssh root@PROD_IP journalctl -u happyhourfriends -p err -n 200 --no-pager

# Since a point in time
ssh root@PROD_IP "journalctl -u happyhourfriends --since '1 hour ago' --no-pager"

# Filter to a specific endpoint/feature (example: the venue signals endpoint)
ssh root@PROD_IP "journalctl -u happyhourfriends -f | grep -i signals"
```

`-f` = follow (live tail), `-p err` = priority error+, `-n N` = last N lines,
`--no-pager` = dump to stdout (needed so the output streams back through `! ssh ...`).

### Restarting / status

```bash
ssh root@PROD_IP systemctl status happyhourfriends
ssh root@PROD_IP systemctl restart happyhourfriends   # after a config/.env change
```

## Sentry (the proper error dashboard + alerting)

- Wired in `instrumentation.ts`. It is a **no-op unless `SENTRY_DSN` is set**:

  ```ts
  const dsn = process.env.SENTRY_DSN;
  if (dsn && (isNode || process.env.NEXT_RUNTIME === "edge")) {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
  }
  ```

- Server errors are captured via `onRequestError = Sentry.captureRequestError`.
- Env vars (see `.env.example`): `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN`
  (client/browser errors).
- **`tracesSampleRate: 0.1`** → 10% of requests traced for performance; errors are
  always captured regardless of this rate.

### Is prod error-capture actually on?

If `SENTRY_DSN` is **not** in prod's `.env`, there is **no error dashboard and no
alerting** — issues are only visible by manually tailing `journalctl`. Check it:

```bash
! ssh root@PROD_IP "grep -c SENTRY_DSN /home/happyhourfriends/.env"
```

- `0` → Sentry is OFF in prod. Set `SENTRY_DSN` (+ `NEXT_PUBLIC_SENTRY_DSN` for client
  errors) in `/home/happyhourfriends/.env`, then `systemctl restart happyhourfriends`.
- `1` → Sentry is capturing; review the Sentry project dashboard for errors/alerts.

For passive "tell me when something breaks" coverage of live user traffic, Sentry is the
right tool — `journalctl` is for active, hands-on tailing.

## Local dev

- `pnpm dev` logs everything to the **terminal it runs in** (stdout/stderr). That
  terminal *is* the local log — request errors, `console.error`, Next warnings.
- **Sentry is inactive locally** (no `SENTRY_DSN` in local `.env`), so the terminal is
  the only place local errors surface.
- Dev **auto-bumps to `:3001`** when `:3000` is taken — check the actual port in the
  startup banner before concluding a change "didn't work".
- After any branch switch / big working-tree change: `rm -rf .next` before restarting
  dev (Turbopack serves stale compiled CSS/RSC; a browser hard-refresh does NOT fix it).

### Let Claude see your local logs

An interactive `pnpm dev` terminal isn't readable by Claude. To share local logs, pipe
dev to a file both of you can read:

```bash
pnpm dev 2>&1 | tee /tmp/hhf-dev.log
```

Then Claude can `tail`/`grep /tmp/hhf-dev.log` on request (e.g. after you exercise a
feature). `tee` overwrites the file on each run.

## Quick reference

```bash
# PROD live tail
ssh root@PROD_IP journalctl -u happyhourfriends -f

# PROD recent errors
ssh root@PROD_IP journalctl -u happyhourfriends -p err -n 200 --no-pager

# PROD: is Sentry on?
ssh root@PROD_IP "grep -c SENTRY_DSN /home/happyhourfriends/.env"

# PROD restart
ssh root@PROD_IP systemctl restart happyhourfriends

# LOCAL dev with a shareable log
pnpm dev 2>&1 | tee /tmp/hhf-dev.log
```
