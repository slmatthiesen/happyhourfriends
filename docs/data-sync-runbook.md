# Data sync runbook (local ⇄ prod) + backups

Prod is a **self-hosted DigitalOcean droplet** (Postgres 17, bound to localhost,
app under systemd unit `happyhourfriends`, app dir `/home/happyhourfriends`). All
three commands below take `PROD_IP` and SSH in as `root`.

## The two-channel model

- **Code** (schema, app, logic) → travels via **git** (`git pull` + `npm run db:migrate`
  on the box). Schema changes ride this channel.
- **Data** → the scripts here. Prod is the source of truth for **user-generated**
  data (submissions, flags, applied edits). Local is the source of truth for
  **seed/curation** (venue + happy-hour discovery) you push up *before launch*.

## Why the old `sync-data-to-prod.sh` failed (lessons baked into the new scripts)

We learned these the hard way pushing the first recovery batch:

1. **Prod `hhf` is not a superuser.** A restore using `pg_dump --disable-triggers`
   emits `SET session_replication_role = replica`, which only a superuser may run.
   → Restore **on the box as `postgres`**, not over a tunnel as `hhf`.
2. **Connection slots fill up.** The app's `postgres.js` pool was holding ~80 of
   100 connections, leaving only superuser-reserved slots → `hhf` couldn't even
   connect. → **Stop the app** during a reload (also avoids `TRUNCATE` lock waits).
3. **Schema must lead data.** A data dump carrying newer columns (e.g.
   `happy_hours.extract_confidence` from migration `0013`) errors mid-restore if
   prod hasn't migrated. → `push:data` runs `db:migrate` **before** loading data.
4. **Circular FK on `neighborhoods`.** Needs `--disable-triggers` on the dump
   (handled), or a custom-format restore (what `pull:data` uses).

> ⚠️ Known prod issue to fix: the app leaks DB connections (80 idle in `postgres.js`).
> Likely `db/client.ts` creating a new pool per call instead of one singleton with a
> sane `max` + `idle_timeout`. Until fixed, real traffic will re-exhaust the 100-slot
> limit and the site itself will throw "remaining connection slots reserved for SUPERUSER".

## Push: local → prod (PRE-LAUNCH full reload)

```bash
PROD_IP=<droplet-ip> npm run push:data
```
Guards: refuses to run if prod has any `audit_log` / `edit_submissions` rows
(i.e. real users) unless you set `FORCE=1`. Steps: schema sync → stop app → dump
local venue tables → scp → truncate+restore as `postgres` → restart → print counts.

**Post-launch:** do NOT use this to add venues — it truncates and would clobber
user edits. Use the **additive push** below instead.

## Additive push: local → prod (POST-LAUNCH safe — never truncates)

```bash
PROD_IP=<droplet-ip> npm run push:data:additive            # DRY RUN (preview counts)
PROD_IP=<droplet-ip> npm run push:data:additive -- --apply # commit
```

Promotes a city you curated locally **without touching anything that already exists on
prod**. Opens an SSH tunnel to prod's Postgres (prod credentials are read off the box,
never written to local disk), then INSERTs only:
- venues whose `google_place_id`/`id` aren't already on prod, plus their happy-hours /
  offerings / tags subtree;
- any missing `cities` / `neighborhoods` / `chains` / `tags` / `seed_candidates`.

It **never modifies an existing prod venue** — a venue users edited on prod is safe, and
a local edit to an *existing* venue will NOT propagate (edit live venues on prod
directly). Defaults to a dry run; add `--apply` to write. Implementation:
`lib/sync/dbSync.ts` (`additivePush`); verified by `npm run test:db-sync`.

## Pull: prod → local (FULL mirror, on demand)

```bash
PROD_IP=<droplet-ip> npm run pull:data
```
Full-DB custom-format dump from prod → `pg_restore --clean` into your local DB.
Brings down everything incl. submissions/flags/audit. **Overwrites local data**, so it
also wipes any city you've staged locally but not pushed. Stop your local `npm run dev`
first so `--clean` can drop objects. For routine refreshes prefer the upsert pull:

## Upsert pull: prod → local (nightly-safe — never deletes)

```bash
PROD_IP=<droplet-ip> npm run pull:data:upsert            # DRY RUN
PROD_IP=<droplet-ip> npm run pull:data:upsert -- --apply # commit
```

The non-destructive counterpart. For every prod row it upserts into local by primary key
(inserts rows users added on prod, updates ones they edited) and **never deletes
local-only rows** — so a city you've staged locally but not yet pushed survives. Safe to
run on a nightly cron mid-curation. Scope = venue/curation tables only (not
`edit_submissions`/`flags`/`audit_log` — use the full `pull:data` when you need those).
Local cron example:
```bash
15 4 * * * cd <repo> && PROD_IP=<ip> npm run pull:data:upsert -- --apply >> /tmp/hhf-pull.log 2>&1
30 4 * * * cd <repo> && PROD_IP=<ip> npm run pull:queue -- --apply >> /tmp/hhf-queue.log 2>&1
```

## Moderation bridge (headless prod → local /admin → auto-publish)

Prod has no /admin. Its AI pipeline auto-applies what it can confirm; the rest park as
`queued_admin`. This bridge brings those leftovers to your local /admin and publishes
your approvals back up.

- **Pull leftovers down** (nightly cron + on demand):
  ```bash
  PROD_IP=<ip> npm run pull:queue            # DRY RUN
  PROD_IP=<ip> npm run pull:queue -- --apply # commit
  ```
  Upserts prod `edit_submissions` rows where `status='queued_admin'` into local by id.
  Idempotent; never deletes. Add to the nightly cron next to `pull:data:upsert`.

- **Approve in local /admin** → the Apply button applies locally AND auto-publishes that
  venue to prod (`publishVenueToProd` → `scripts/publish-venue-to-prod.sh`), flipping the
  prod submission to `applied`. Needs `PROD_IP` in the local environment; without it the
  apply still works locally and publishing is skipped.

- **Revert** round-trips: reverting an applied change publishes the reverted venue state
  (restored or soft-deleted) back to prod too.

> Follow-up (tracked, not yet done): use a dedicated, narrowly-scoped SSH key for publish
> instead of the root key the sync scripts currently use.

### Manual end-to-end smoke (requires prod access)

1. Create a `queued_admin` submission on prod (via the live submit flow or psql).
2. Pull it down: `PROD_IP=<ip> npm run pull:queue` then `… -- --apply`.
3. Confirm it appears in local /admin (`npm run dev` → /admin).
4. Approve it in /admin. Confirm: local DB shows the change; prod shows the change
   (psql over the tunnel); prod `edit_submissions.status` is now `applied`.
5. Revert it in /admin/audit. Confirm prod reflects the revert.

## Nightly backups (on the droplet — the real safety net)

The reliable nightly job lives on the **server**, not your Mac. `scripts/backup/hhf-pg-backup.sh`
writes a compressed full dump and prunes ones older than 14 days.

Install once on the droplet (as root):
```bash
chmod +x /home/happyhourfriends/scripts/backup/hhf-pg-backup.sh
crontab -e
# add this line (3:15am daily):
15 3 * * * /home/happyhourfriends/scripts/backup/hhf-pg-backup.sh >> /var/log/hhf-backup.log 2>&1
```
Backups land in `/var/backups/happyhourfriends/`, retained 14 days
(`HHF_BACKUP_KEEP_DAYS` to change). Verify after a day: `ls -lh /var/backups/happyhourfriends/`.

**Restore from a backup:**
```bash
sudo -u postgres pg_restore --clean --if-exists -d happyhourfriends \
  /var/backups/happyhourfriends/happyhourfriends-YYYY-MM-DD-HHMMSS.dump
```

> Recommended belt-and-suspenders: also enable DigitalOcean droplet snapshots /
> a weekly off-box copy, so a lost droplet doesn't lose the backups with it.
