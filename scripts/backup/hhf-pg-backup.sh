#!/usr/bin/env bash
# Nightly prod Postgres backup with retention. Runs ON THE DROPLET (root cron).
#
# Writes a compressed custom-format dump (restorable with pg_restore) and prunes
# dumps older than KEEP_DAYS. This is the real safety net for user submissions —
# it captures the WHOLE database, not just venue tables.
#
# Install (on the droplet, as root):
#   chmod +x /home/happyhourfriends/scripts/backup/hhf-pg-backup.sh
#   crontab -e   # add:
#   15 3 * * * /home/happyhourfriends/scripts/backup/hhf-pg-backup.sh >> /var/log/hhf-backup.log 2>&1
#
# Restore a backup:
#   sudo -u postgres pg_restore --clean --if-exists -d happyhourfriends \
#     /var/backups/happyhourfriends/happyhourfriends-YYYY-MM-DD-HHMMSS.dump
#
# Env overrides: HHF_DB, HHF_BACKUP_DIR, HHF_BACKUP_KEEP_DAYS.
set -euo pipefail

DB="${HHF_DB:-happyhourfriends}"
DIR="${HHF_BACKUP_DIR:-/var/backups/happyhourfriends}"
KEEP_DAYS="${HHF_BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DIR"
TS="$(date +%F-%H%M%S)"
FILE="${DIR}/${DB}-${TS}.dump"

# Dump to a .part file first so a crash never leaves a truncated "valid-looking" dump.
sudo -u postgres pg_dump -Fc "$DB" > "${FILE}.part"
mv "${FILE}.part" "$FILE"

# Retention: drop dumps older than KEEP_DAYS.
find "$DIR" -name "${DB}-*.dump" -type f -mtime +"${KEEP_DAYS}" -delete

echo "$(date -Is) backup → ${FILE} ($(du -h "$FILE" | cut -f1)); retention ${KEEP_DAYS}d"
