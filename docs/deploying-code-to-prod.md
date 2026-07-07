# Deploying code to prod

**One command:** `pnpm deploy:prod`

Merging a PR to `main` does **not** deploy — CI (`ci.yml`) only runs tests/lint/gitleaks.
Nothing on the AWS box auto-pulls. Shipping code is a separate, explicit step.

## One-time setup

Same identifiers as `docs/pushing-data-to-prod.md`, in your gitignored `.env`:

```
PROD_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx   # EC2 prod box instance id
AWS_PROFILE=<profile>                  # AWS profile with ssm:SendCommand
```

`AWS_REGION` defaults to `us-east-1`.

## Use it

```bash
pnpm deploy:prod
```

That's it — no SSH, no pasting multi-line commands into a remote shell.

## What it does

Sends the whole deploy as a single **non-interactive** `aws ssm send-command`
(`AWS-RunShellScript`), which the SSM agent runs as **root** on the box:

1. `git fetch` + `git merge --ff-only origin/main` (as the `hhf` user, so file ownership
   under `/opt/happyhourfriends` never drifts to root)
2. `npm run build` && `npm run db:migrate` (env sourced from `/etc/happyhour/.env`;
   `db:migrate` is a no-op if there's nothing pending, so it's safe to always run)
3. `systemctl restart hhf-web`
4. Health check: confirms the service is active and the homepage responds `200`
5. Best-effort ISR cache refresh (same mechanism as `push:prod`), so template/copy
   changes show up immediately instead of waiting out the cache window

Full stdout/stderr from the box is printed locally — no separate SSM session to babysit.

## Why not just SSH/SSM in and run it by hand

An interactive `aws ssm start-session` logs in as `ssm-user`, not root — `sudo -u hhf …`
inside that session needs `ssm-user` to have sudo rights, which is a common source of a
confusing "permission denied" that has nothing to do with the actual deploy steps.
Pasting a multi-line command block into an interactive remote shell is also a frequent
source of quoting/paste corruption. Running the whole thing as one `send-command` sidesteps
both: the SSM agent executes it as root (no sudo-password friction), and there's no
interactive paste step at all.

## If it fails

The script prints the box's stdout/stderr before exiting non-zero — read that first, it's
the actual remote failure (a failed build, a failed migration, `git merge --ff-only`
refusing because the box has local drift, etc.), not a local script bug. `git merge
--ff-only` failing usually means someone edited files directly on the box — investigate
before force-pushing over it.
