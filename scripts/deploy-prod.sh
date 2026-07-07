#!/usr/bin/env bash
# deploy:prod — the one command to ship a merged `main` to the AWS prod box.
#
# Runs the whole deploy (git pull, build, migrate, restart) as a single non-interactive
# AWS SSM RunCommand, executed as root on the box (root can `sudo -u hhf ...` without a
# password — unlike an interactive `ssm start-session`, which logs in as `ssm-user` and
# may not have sudo rights to switch users, the classic source of a confusing "permission
# denied" when pasting this by hand). No manual multi-line paste into a remote shell, so
# no quoting/paste corruption either.
#
#   pnpm deploy:prod
#
# One-time setup — put these in your gitignored .env (NEVER committed; this is a public repo):
#   PROD_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx   # EC2 prod box instance id
#   AWS_PROFILE=<profile>                  # AWS profile with ssm:SendCommand
# AWS_REGION defaults to us-east-1.
set -euo pipefail

if [ -f ./.env ]; then set -a; source ./.env; set +a; fi
missing=()
[ -n "${PROD_INSTANCE_ID:-}" ] || missing+=(PROD_INSTANCE_ID)
[ -n "${AWS_PROFILE:-}" ] || missing+=(AWS_PROFILE)
if [ "${#missing[@]}" -gt 0 ]; then
  echo "✗ deploy:prod needs: ${missing[*]}"
  echo "  Add to your gitignored .env:"
  echo "    PROD_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx"
  echo "    AWS_PROFILE=<your-aws-profile>"
  exit 1
fi
export AWS_REGION="${AWS_REGION:-us-east-1}"

echo "▶ deploy:prod — deploying main to ${PROD_INSTANCE_ID}…"

# Runs as root via SSM RunCommand. git/build/migrate run as `hhf` (the app's owning user —
# staying consistent with how infra/user_data.sh originally provisioned the box) so file
# ownership under /opt/happyhourfriends never drifts to root.
REMOTE_SCRIPT='
set -euo pipefail
cd /opt/happyhourfriends
BEFORE_SHA="$(sudo -u hhf git rev-parse --short HEAD)"
sudo -u hhf git fetch origin
sudo -u hhf git merge --ff-only origin/main
AFTER_SHA="$(sudo -u hhf git rev-parse --short HEAD)"
echo "commit: ${BEFORE_SHA} -> ${AFTER_SHA}"
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf bash -c "
  set -a; . /etc/happyhour/.env; set +a
  cd /opt/happyhourfriends
  npm run build
  npm run db:migrate
"
systemctl restart hhf-web
sleep 3
systemctl is-active --quiet hhf-web && echo "hhf-web: active" || { echo "hhf-web: NOT active"; exit 1; }
curl -fsS -o /dev/null -w "homepage: %{http_code}\n" http://127.0.0.1:3000/
'

# A real JSON params file, not the `commands=[...]` shorthand — shorthand double-wraps
# the already-JSON-encoded multiline script into a nested list, which AWS CLI rejects
# with a "Parameter validation failed" client-side error (never reaches AWS).
PARAMS_FILE="$(mktemp -t hhf-deploy-params.XXXXXX.json)"
trap 'rm -f "$PARAMS_FILE"' EXIT
node -e 'process.stdout.write(JSON.stringify({commands:[process.argv[1]]}))' "$REMOTE_SCRIPT" > "$PARAMS_FILE"

CID="$(aws ssm send-command --instance-ids "$PROD_INSTANCE_ID" --document-name AWS-RunShellScript \
      --parameters "file://$PARAMS_FILE" \
      --timeout-seconds 900 \
      --query Command.CommandId --output text)"
[ -n "$CID" ] || { echo "✗ send-command failed — no CommandId returned"; exit 1; }
echo "▶ Command sent (${CID}), waiting…"

STATUS="InProgress"
for _ in $(seq 1 200); do
  STATUS="$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
            --query Status --output text 2>/dev/null || echo InProgress)"
  case "$STATUS" in
    Pending|InProgress|Delayed) sleep 3 ;;
    *) break ;;
  esac
done

echo "--- stdout ---"
aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
  --query StandardOutputContent --output text
echo "--- stderr ---"
aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
  --query StandardErrorContent --output text

if [ "$STATUS" = "Success" ]; then
  echo "✓ deploy:prod — ${STATUS}"
else
  echo "✗ deploy:prod — ${STATUS}"
  exit 1
fi

# Best-effort ISR cache refresh so template/copy changes (not just data) show immediately.
source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh" 2>/dev/null || true
if declare -f refresh_prod_cache_ssm >/dev/null; then
  refresh_prod_cache_ssm "$PROD_INSTANCE_ID" \
    || echo "⚠ Cache refresh skipped/failed — code IS deployed; pages refresh within the hour."
fi
