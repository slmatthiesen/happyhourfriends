#!/usr/bin/env bash
# Push local venue/HH data UP to prod — PRE-LAUNCH full reload.
#
# Codifies the working path discovered the hard way (see docs/data-sync-runbook.md).
# Supersedes the old tunnel-based scripts/sync-data-to-prod.sh, which can't run:
# prod's `hhf` role is NOT a superuser, so `--disable-triggers` + the
# superuser-reserved connection slots both block an over-the-tunnel restore.
# Instead we restore ON the droplet as the `postgres` superuser via SSH.
#
# Order matters (each step is a wall we hit by hand):
#   1. guard: refuse if prod has real user data (unless FORCE=1)
#   2. schema FIRST: git pull + db:migrate on prod (else the data dump's newer
#      columns, e.g. extract_confidence, error out mid-restore)
#   3. stop the app: frees its connection pool + avoids TRUNCATE lock waits
#   4. dump local (--disable-triggers for the circular neighborhoods FK) → scp → restore
#   5. restart + print counts
#
# Usage:  npm run push:data            (PROD_IP from .env)
#         PROD_IP=203.0.113.10 npm run push:data
# Env:    PROD_IP (from .env or inline); SSH_USER=root, APP_DIR=/home/happyhourfriends,
#         BRANCH=main, DB=happyhourfriends, SVC=happyhourfriends,
#         FORCE=1 (override the post-launch guard — DANGEROUS).
set -euo pipefail

# PROD_IP may come from .env (an inline PROD_IP=... still wins).
if [ -z "${PROD_IP:-}" ] && [ -f ./.env ]; then
  PROD_IP="$(sed -n 's/^PROD_IP=//p' ./.env | head -1 | tr -d "'\"")"
fi
PROD_IP="${PROD_IP:?Set PROD_IP (droplet IP) in .env or inline}"
SSH_USER="${SSH_USER:-root}"
APP_DIR="${APP_DIR:-/home/happyhourfriends}"
BRANCH="${BRANCH:-main}"
DB="${DB:-happyhourfriends}"
SVC="${SVC:-happyhourfriends}"
# -n: never read stdin, so remote commands can't swallow the `read` prompt's input.
SSH="ssh -n ${SSH_USER}@${PROD_IP}"

# Local DB URL comes from .env (same value db:migrate / the app use locally).
set -a; source ./.env; set +a
LOCAL_DB_URL="${DATABASE_URL:?DATABASE_URL missing from .env}"

TABLES=(cities neighborhoods chains venues happy_hours happy_hour_exceptions offerings tags venue_tags seed_candidates)
TRUNCATE_LIST="$(IFS=,; echo "${TABLES[*]}")"

echo "▶ Target ${SSH_USER}@${PROD_IP} db=${DB} branch=${BRANCH}"

# 1. Pre-launch guard — never truncate over real user data unless explicitly forced.
ROWS="$($SSH "sudo -u postgres psql -d ${DB} -At -c \"SELECT coalesce((SELECT count(*) FROM audit_log),0)+coalesce((SELECT count(*) FROM edit_submissions),0);\"" 2>/dev/null || echo ERR)"
[[ "$ROWS" == "ERR" ]] && { echo "✗ Could not reach prod DB over SSH."; exit 1; }
if [[ "$ROWS" -gt 0 && "${FORCE:-0}" != "1" ]]; then
  echo "✗ Prod has ${ROWS} audit_log/edit_submissions rows."
  echo "  This is a DESTRUCTIVE full reload — post-launch it would clobber user data."
  echo "  Use the enrich-over-tunnel path for new venues, or set FORCE=1 if you are certain."
  exit 1
fi

read -r -p "Full reload of ${#TABLES[@]} tables on PROD from local. Continue? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }

# 2. Schema before data.
echo "▶ Syncing prod schema (git pull + db:migrate)…"
$SSH "cd ${APP_DIR} && git fetch origin && git checkout ${BRANCH} && git pull --ff-only && npm run db:migrate"

# 3. Stop the app to release the connection pool.
echo "▶ Stopping ${SVC}…"
$SSH "systemctl stop ${SVC}"

# 4. Dump local → upload → restore as postgres.
echo "▶ Dumping local data…"
DUMP_ARGS=(); for t in "${TABLES[@]}"; do DUMP_ARGS+=(-t "$t"); done
TMP="$(mktemp -t hhf-push.XXXXXX).sql"
trap 'rm -f "$TMP"' EXIT
pg_dump --data-only --no-owner --no-acl --disable-triggers "${DUMP_ARGS[@]}" "$LOCAL_DB_URL" > "$TMP"
echo "  $(du -h "$TMP" | cut -f1) → uploading…"
scp -q "$TMP" "${SSH_USER}@${PROD_IP}:/tmp/hhf-push.sql"

echo "▶ Restoring on prod (truncate + load as postgres)…"
$SSH "sudo -u postgres psql -d ${DB} -v ON_ERROR_STOP=1 -c \"TRUNCATE ${TRUNCATE_LIST} RESTART IDENTITY CASCADE;\""
$SSH "sudo -u postgres psql -d ${DB} -v ON_ERROR_STOP=1 --single-transaction -f /tmp/hhf-push.sql"
$SSH "rm -f /tmp/hhf-push.sql"

# 5. Restart + verify.
echo "▶ Starting ${SVC}…"
$SSH "systemctl start ${SVC}"
echo "▶ Prod counts:"
$SSH "sudo -u postgres psql -d ${DB} -c \"SELECT (SELECT count(*) FROM venues) AS venues, (SELECT count(*) FROM happy_hours) AS happy_hours, (SELECT count(*) FROM offerings) AS offerings;\""
echo "✅ Push complete."
