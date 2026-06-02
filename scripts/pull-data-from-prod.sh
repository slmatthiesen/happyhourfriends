#!/usr/bin/env bash
# Pull the FULL prod DB DOWN into the local dev DB.
#
# Mirrors prod exactly — including user submissions, flags, and audit_log — so you
# can develop against real data and capture what users have submitted. OVERWRITES
# local data. Prod is the source of truth for user-generated data.
#
# Uses a custom-format (`-Fc`) full dump produced on the droplet as the `postgres`
# superuser, restored locally with pg_restore --clean (local `hhf` is a superuser
# in the docker image, so CREATE EXTENSION / triggers are fine). pg_restore loads
# FK constraints after data, so no --disable-triggers is needed.
#
# Usage:  PROD_IP=203.0.113.10 npm run pull:data
# Env:    PROD_IP (required); SSH_USER=root, DB=happyhourfriends.
# Tip:    stop your local `npm run dev` first so --clean can drop objects cleanly.
set -euo pipefail

PROD_IP="${PROD_IP:?Set PROD_IP (droplet IP)}"
SSH_USER="${SSH_USER:-root}"
DB="${DB:-happyhourfriends}"
SSH="ssh ${SSH_USER}@${PROD_IP}"

set -a; source ./.env; set +a
LOCAL_DB_URL="${DATABASE_URL:?DATABASE_URL missing from .env}"

read -r -p "This OVERWRITES your local ${DB} with prod data. Continue? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }

DUMP="$(mktemp -t hhf-pull.XXXXXX).dump"
trap 'rm -f "$DUMP"' EXIT

echo "▶ Dumping full prod DB (as postgres)…"
$SSH "sudo -u postgres pg_dump -Fc ${DB}" > "$DUMP"
echo "  $(du -h "$DUMP" | cut -f1) downloaded → restoring locally…"

pg_restore --clean --if-exists --no-owner --no-acl -d "$LOCAL_DB_URL" "$DUMP"

echo "▶ Local counts:"
psql "$LOCAL_DB_URL" -c "SELECT (SELECT count(*) FROM venues) AS venues, (SELECT count(*) FROM happy_hours) AS happy_hours, (SELECT count(*) FROM edit_submissions) AS submissions;"
echo "✅ Pull complete."
