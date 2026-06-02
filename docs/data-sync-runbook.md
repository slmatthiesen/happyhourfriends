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
user edits. Add new venues with the enrich pipeline pointed at prod over an SSH
tunnel (dedups on `google_place_id`).

## Pull: prod → local (mirror, on demand)

```bash
PROD_IP=<droplet-ip> npm run pull:data
```
Full-DB custom-format dump from prod → `pg_restore --clean` into your local DB.
Brings down everything incl. submissions/flags/audit. **Overwrites local data.**
Stop your local `npm run dev` first so `--clean` can drop objects.

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
