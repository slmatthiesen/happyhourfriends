#!/usr/bin/env bash
# Shared helper: open an SSH tunnel to prod's Postgres, derive PROD_DATABASE_URL from
# the droplet's own .env (so prod credentials are NEVER written to local disk), then
# exec the db-sync CLI. Sourced by push-deletions.sh / pull-queue-from-prod.sh / publish-venue-to-prod.sh.
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

  # Reap any tunnel leaked by a prior aborted run that's still holding the port —
  # otherwise ssh -L can't bind ("Address already in use") and the sync would silently
  # run against the stale forward instead of a fresh one.
  if pkill -f "ssh -fN -M -S /tmp/hhf-tunnel\..* -L ${TUNNEL_PORT}:localhost:5432" 2>/dev/null; then
    echo "▶ Reaped a stale tunnel still holding :${TUNNEL_PORT}"
    sleep 1
  fi

  # Open a tunnel via a control socket so we can tear it down cleanly. SOCK is baked into
  # the trap at definition time (not expanded at EXIT) because it's function-local and
  # would be out of scope — and thus unbound under `set -u` — by the time the trap fires.
  local SOCK; SOCK="$(mktemp -u /tmp/hhf-tunnel.XXXXXX)"
  ssh -fN -M -S "$SOCK" -L "${TUNNEL_PORT}:localhost:5432" "${SSH_USER}@${PROD_IP}"
  trap 'ssh -S "'"$SOCK"'" -O exit "'"${SSH_USER}@${PROD_IP}"'" 2>/dev/null || true' EXIT
  echo "▶ Tunnel up: 127.0.0.1:${TUNNEL_PORT} → ${PROD_IP}:5432"

  DATABASE_URL="$DATABASE_URL" PROD_DATABASE_URL="$PROD_DATABASE_URL" \
    ./node_modules/.bin/tsx scripts/sync/db-sync.ts "$direction" "$@"

  # A data sync writes straight to prod's DB, bypassing the apply engine that normally
  # busts the public read cache — so without this the new rows sit behind the ISR window
  # (city pages 1h, landing counts 1 day). After a real push (push + --apply, not a dry
  # run), tell prod to purge its public cache so the data shows immediately. Best-effort:
  # the data is already written, so a refresh failure must not fail the sync.
  if { [ "$direction" = push ] || [ "$direction" = delete-venues ]; } && printf '%s\n' "$@" | grep -qxF -- --apply; then
    refresh_prod_cache "$SSH_USER" "$PROD_IP" "$APP_DIR" || \
      echo "⚠ Cache refresh failed — data IS written; pages refresh within the hour, or re-run the refresh."
  fi
}

# POST to prod's internal revalidate endpoint over the loopback on the box (so the prod
# REVALIDATE_SECRET never leaves the droplet). Sends `all:true` for a full purge AND an
# explicit city-path list + counts tag, so it works whether or not prod has the newer
# `all`-aware endpoint deployed yet.
refresh_prod_cache() {
  local ssh_user="$1" prod_ip="$2" app_dir="$3"
  local paths_json
  paths_json="$(ssh -n "${ssh_user}@${prod_ip}" \
    "sudo -u postgres psql -d happyhourfriends -At -c \"SELECT '/'||lower(state)||'/'||slug FROM cities ORDER BY slug;\"" \
    | sed 's/.*/\"&\"/' | paste -sd, -)" || return 1
  [ -n "$paths_json" ] || return 1
  local body="{\"all\":true,\"paths\":[${paths_json}],\"tags\":[\"cities-summary\"]}"
  ssh -n "${ssh_user}@${prod_ip}" \
    "SECRET=\$(sed -n 's/^REVALIDATE_SECRET=//p' ${app_dir}/.env | head -1 | tr -d '\"'); \
     curl -fsS -X POST http://127.0.0.1:3000/api/internal/revalidate \
       -H 'content-type: application/json' -H \"x-revalidate-secret: \$SECRET\" \
       -d '${body}' >/dev/null" || return 1
  echo "▶ Refreshed prod public cache (all city pages + landing counts)"
}
