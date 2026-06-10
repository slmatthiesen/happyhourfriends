#!/usr/bin/env bash
# Shared helper: open an SSH tunnel to prod's Postgres, derive PROD_DATABASE_URL from
# the droplet's own .env (so prod credentials are NEVER written to local disk), then
# exec the db-sync CLI. Sourced by push-data-additive.sh / pull-data-upsert.sh.
#
# Usage (from a wrapper): run_sync <push|pull> "$@"
# Env: PROD_IP (from .env or inline); SSH_USER=root, APP_DIR=/home/happyhourfriends, TUNNEL_PORT=6543.
set -euo pipefail

run_sync() {
  local direction="$1"; shift
  # PROD_IP may come from .env (an inline PROD_IP=... still wins).
  if [ -z "${PROD_IP:-}" ] && [ -f ./.env ]; then
    PROD_IP="$(sed -n 's/^PROD_IP=//p' ./.env | head -1 | tr -d "'\"")"
  fi
  local PROD_IP="${PROD_IP:?Set PROD_IP (droplet IP) in .env or inline}"
  local SSH_USER="${SSH_USER:-root}"
  local APP_DIR="${APP_DIR:-/home/happyhourfriends}"
  local TUNNEL_PORT="${TUNNEL_PORT:-6543}"

  # Local DB URL from .env (same value the app + db:migrate use locally).
  set -a; source ./.env; set +a
  : "${DATABASE_URL:?DATABASE_URL missing from .env}"

  # Read prod's DATABASE_URL off the box and retarget host:port → the local tunnel end.
  local raw
  raw="$(ssh -n "${SSH_USER}@${PROD_IP}" "grep -E '^DATABASE_URL=' ${APP_DIR}/.env | head -1 | cut -d= -f2-")"
  raw="${raw%\"}"; raw="${raw#\"}"; raw="${raw%\'}"; raw="${raw#\'}"
  [[ -n "$raw" ]] || { echo "✗ Could not read DATABASE_URL from ${APP_DIR}/.env on prod."; exit 1; }
  local PROD_DATABASE_URL
  PROD_DATABASE_URL="$(printf '%s' "$raw" | sed -E "s#@[^/]+/#@127.0.0.1:${TUNNEL_PORT}/#")"

  # Open a tunnel via a control socket so we can tear it down cleanly.
  local SOCK; SOCK="$(mktemp -u /tmp/hhf-tunnel.XXXXXX)"
  ssh -fN -M -S "$SOCK" -L "${TUNNEL_PORT}:localhost:5432" "${SSH_USER}@${PROD_IP}"
  trap 'ssh -S "$SOCK" -O exit "'"${SSH_USER}@${PROD_IP}"'" 2>/dev/null || true' EXIT
  echo "▶ Tunnel up: 127.0.0.1:${TUNNEL_PORT} → ${PROD_IP}:5432"

  DATABASE_URL="$DATABASE_URL" PROD_DATABASE_URL="$PROD_DATABASE_URL" \
    ./node_modules/.bin/tsx scripts/sync/db-sync.ts "$direction" "$@"
}
