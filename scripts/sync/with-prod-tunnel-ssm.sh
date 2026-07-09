#!/usr/bin/env bash
# SSM variant of with-prod-tunnel.sh — for the AWS EC2 prod box, whose security group
# closes port 22 (no SSH). Opens an SSM port-forwarding session to the box's Postgres,
# reads the prod DATABASE_URL from Secrets Manager (never written to disk), retargets it
# at the local tunnel end, then execs the db-sync CLI. Sourced by *-ssm.sh wrappers.
#
# Usage (from a wrapper): run_sync <push|pull|...> "$@"
#
# ALL prod identifiers come from the environment / gitignored .env — nothing is hardcoded,
# so this file is safe in the public repo. Required / optional env:
#   PROD_INSTANCE_ID   (required)  EC2 instance id, e.g. from
#                                  `aws ec2 describe-instances --filters Name=tag:Name,Values=<box>`
#   AWS_PROFILE        (required)  profile with ssm:StartSession + secretsmanager:GetSecretValue
#   AWS_REGION         (default us-east-1)
#   PROD_SECRET_ID     (default budget/secrets)   Secrets Manager id holding {"DATABASE_URL": ...}
#   TUNNEL_PORT        (default 6543)
set -euo pipefail

run_sync() {
  local direction="$1"; shift

  # Disable AWS CLI v2's default pager (`less`) so its output streams instead of dropping
  # the caller into a vi-like screen they have to `:q` out of.
  export AWS_PAGER=""

  # Local DB URL from .env (same value the app + db:migrate use locally).
  set -a; source ./.env; set +a
  : "${DATABASE_URL:?DATABASE_URL missing from .env}"

  local INSTANCE_ID="${PROD_INSTANCE_ID:?Set PROD_INSTANCE_ID (EC2 id) in .env or inline}"
  local SECRET_ID="${PROD_SECRET_ID:-budget/secrets}"
  local TUNNEL_PORT="${TUNNEL_PORT:-6543}"
  export AWS_REGION="${AWS_REGION:-us-east-1}"
  : "${AWS_PROFILE:?Set AWS_PROFILE (an AWS profile with SSM + Secrets Manager access)}"

  command -v session-manager-plugin >/dev/null \
    || { echo "✗ session-manager-plugin not installed (brew install --cask session-manager-plugin)"; exit 1; }

  # Prod DATABASE_URL from Secrets Manager — kept in a shell var, never on disk. Retarget its
  # host:port (the box's localhost:5432) at the local tunnel end (same rewrite as the SSH path).
  local prod_url
  prod_url="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" \
      --query SecretString --output text \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).DATABASE_URL||"")}catch(e){}})')"
  [ -n "$prod_url" ] || { echo "✗ Could not read DATABASE_URL from secret '$SECRET_ID'"; exit 1; }
  local PROD_DATABASE_URL
  PROD_DATABASE_URL="$(printf '%s' "$prod_url" | sed -E "s#@[^/]+/#@127.0.0.1:${TUNNEL_PORT}/#")"

  # Reap a tunnel leaked by a prior aborted run still holding the port.
  pkill -f "AWS-StartPortForwardingSession.*${TUNNEL_PORT}" 2>/dev/null && { echo "▶ Reaped a stale SSM tunnel on :${TUNNEL_PORT}"; sleep 1; } || true

  # Open the SSM port-forward (box:5432 → 127.0.0.1:TUNNEL_PORT) in the background; tear down on exit.
  local SSM_LOG; SSM_LOG="$(mktemp -t hhf-ssm.XXXXXX)"
  aws ssm start-session --target "$INSTANCE_ID" \
    --document-name AWS-StartPortForwardingSession \
    --parameters "{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"${TUNNEL_PORT}\"]}" >"$SSM_LOG" 2>&1 &
  local SSM_PID=$!
  trap 'kill "'"$SSM_PID"'" 2>/dev/null || true; rm -f "'"$SSM_LOG"'"' EXIT

  # Wait for the forward to accept connections (up to ~30s).
  local up=""
  for _ in $(seq 1 30); do
    if nc -z 127.0.0.1 "$TUNNEL_PORT" 2>/dev/null; then up=1; break; fi
    kill -0 "$SSM_PID" 2>/dev/null || { echo "✗ SSM session exited early:"; cat "$SSM_LOG"; exit 1; }
    sleep 1
  done
  [ -n "$up" ] || { echo "✗ SSM tunnel didn't come up in 30s:"; cat "$SSM_LOG"; exit 1; }
  echo "▶ SSM tunnel up: 127.0.0.1:${TUNNEL_PORT} → ${INSTANCE_ID}:5432"

  DATABASE_URL="$DATABASE_URL" PROD_DATABASE_URL="$PROD_DATABASE_URL" \
    ./node_modules/.bin/tsx scripts/sync/db-sync.ts "$direction" "$@"

  # Post-apply cache refresh: a data sync writes straight to prod's DB, bypassing the apply
  # engine that busts the public read cache, so new rows sit behind ISR (city 1h, counts 1d)
  # until this fires. Best-effort over SSM — the data is already written, so a refresh failure
  # must not fail the sync (and the send-command may be gated; re-run the refresh if so).
  if { [ "$direction" = push ] || [ "$direction" = push-updates ] || [ "$direction" = delete-venues ]; } && printf '%s\n' "$@" | grep -qxF -- --apply; then
    refresh_prod_cache_ssm "$INSTANCE_ID" \
      || echo "⚠ Cache refresh skipped/failed — data IS written; pages refresh within the hour."
  fi
}

# Purge prod's public cache by POSTing to its internal revalidate endpoint over the box's
# loopback (so REVALIDATE_SECRET never leaves the box). Runs via SSM RunShellScript.
refresh_prod_cache_ssm() {
  local instance_id="$1"
  local script='set -e; ENV=/etc/happyhour/.env; SECRET=$(sudo sed -n "s/^REVALIDATE_SECRET=//p" "$ENV" | head -1 | tr -d "\"'"'"'"); PATHS=$(sudo -u postgres psql -d hhf -At -c "SELECT '"'"'/'"'"'||lower(state)||'"'"'/'"'"'||slug FROM cities WHERE status='"'"'live'"'"' ORDER BY slug;" | sed "s/.*/\"&\"/" | paste -sd, -); curl -fsS -X POST http://127.0.0.1:3000/api/internal/revalidate -H "content-type: application/json" -H "x-revalidate-secret: $SECRET" -d "{\"all\":true,\"paths\":[$PATHS],\"tags\":[\"cities-summary\"]}" >/dev/null && echo REVALIDATED'
  # A real JSON params file, not the `commands=[...]` shorthand — shorthand double-wraps the
  # already-JSON-encoded script into a nested list, which AWS CLI rejects client-side before
  # ever reaching AWS (silently, since callers redirect stderr away and treat this as best-effort).
  local params_file
  params_file="$(mktemp -t hhf-cache-refresh-params.XXXXXX.json)"
  node -e 'process.stdout.write(JSON.stringify({commands:[process.argv[1]]}))' "$script" > "$params_file"
  local cid
  cid="$(aws ssm send-command --instance-ids "$instance_id" --document-name AWS-RunShellScript \
        --parameters "file://$params_file" \
        --query Command.CommandId --output text 2>/dev/null)" || { rm -f "$params_file"; return 1; }
  rm -f "$params_file"
  [ -n "$cid" ] || return 1
  sleep 6
  aws ssm get-command-invocation --command-id "$cid" --instance-id "$instance_id" \
    --query StandardOutputContent --output text 2>/dev/null | grep -q REVALIDATED \
    && echo "▶ Refreshed prod public cache (all live city pages + landing counts)"
}
