# Pushing data to prod

**One command:** `pnpm push:prod` (preview) → `pnpm push:prod -- --apply` (commit).

Local is the source of truth for **curation** (venues, happy hours, offerings, neighborhoods
from the pipeline). Prod is the source of truth for **user data** (submissions, flags,
audit log). `push:prod` moves curation up without ever clobbering user data.

## One-time setup

The prod identifiers live in your **gitignored `.env`** — this is a public repo, so nothing
prod-specific is committed. Add two lines:

```
PROD_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx   # EC2 prod box instance id
AWS_PROFILE=<profile>                  # AWS profile with SSM + Secrets Manager access
```

`AWS_REGION` defaults to `us-east-1` and `PROD_SECRET_ID` to `budget/secrets` — override in
`.env` only if they differ. You also need the SSM plugin once:
`brew install --cask session-manager-plugin`.

The prod Postgres **password is never on disk or in git** — the sync reads it from AWS
Secrets Manager at run time over an SSM tunnel (port 22 is closed on the box).

## Use it

```bash
pnpm push:prod             # PREVIEW: prints exactly what would change, writes nothing
pnpm push:prod -- --apply  # commit the change to prod
```

Always preview first. On `--apply` it also refreshes prod's public page cache (ISR) for
every live city, so changes show up immediately instead of within the hour.

## What it does (and why it's safe)

`push:prod` runs the "update-push":

1. **Additive insert** — new local venues (and their happy hours / offerings / neighborhoods)
   that prod doesn't have yet. INSERT-only; never modifies an existing prod row.
2. **Re-publish changed** — for every venue that already exists on prod and whose local
   curation subtree is **newer than your last push**, upsert its whole subtree (including
   `neighborhood_id`, its city row, and any new neighborhood polygons it points at).

Safety rails:

- A venue a **user edited more recently on prod is skipped** — prod wins, so user-applied
  changes are never overwritten.
- Only **curation tables** move. `edit_submissions`, flags, and `audit_log` are never touched.
- The "changed" scan is bounded by a **local watermark** (`.push-prod-state.json`, gitignored —
  the timestamp of your last successful `--apply`), not a fixed window. First run ever (no
  watermark yet) falls back to the last 24h. A push touches only venues edited since you last
  pushed, so it stays fast regardless of how much unrelated pipeline activity happened earlier.

## Do NOT `pull` first for a fresh curation push

The general advice is "pull user edits down before pushing up," but `pull:data:upsert`
overwrites local rows by primary key with **no timestamp guard** — it will revert
freshly-generated local curation (e.g. neighborhood assignments you just ran). For a
same-session curation push, push directly; `push:prod` already protects prod's newer rows.
Only pull first when you specifically need to reconcile user edits made on prod.

## Other push tools (rarely needed)

- `pnpm push:deletions -- --apply` — propagate local soft-deletions (removed stubs) to prod.
- `pnpm publish:venue -- --venue <id> --apply` — publish a single venue instantly (one PK
  upsert of just that subtree, no venue scan at all). This is what the admin `/admin` Apply
  button calls automatically after you approve a submission — use it by hand too when you
  hand-edited exactly one venue locally and don't want to wait on the broader `push:prod` scan.

`push:prod` is the everyday path for "publish everything I changed this session"; reach for
`publish:venue` when you know the single venue id and want it live immediately.
