#!/usr/bin/env bash
# diagnose:prod-git — read-only. Shows exactly why the box's local `main` and
# `origin/main` have diverged (deploy:prod's `git merge --ff-only` refuses in that
# case rather than guess). Fetches on the box, then prints:
#   - commits the box has that origin doesn't (should normally be NONE — the box
#     is a deploy target, not a dev environment; if non-empty, something committed
#     directly on it)
#   - commits origin has that the box doesn't (the deploy it's behind on)
# Touches nothing. Same one-time setup as deploy:prod (.env: PROD_INSTANCE_ID, AWS_PROFILE).
set -euo pipefail

if [ -f ./.env ]; then set -a; source ./.env; set +a; fi
missing=()
[ -n "${PROD_INSTANCE_ID:-}" ] || missing+=(PROD_INSTANCE_ID)
[ -n "${AWS_PROFILE:-}" ] || missing+=(AWS_PROFILE)
if [ "${#missing[@]}" -gt 0 ]; then
  echo "✗ diagnose:prod-git needs: ${missing[*]}"
  exit 1
fi
export AWS_REGION="${AWS_REGION:-us-east-1}"

REMOTE_SCRIPT='
set -eu
cd /opt/happyhourfriends
sudo -u hhf git fetch origin
echo "--- HEAD ---"
sudo -u hhf git rev-parse --short HEAD
echo "--- box has, origin does not (should be EMPTY) ---"
sudo -u hhf git log origin/main..HEAD --oneline || true
echo "--- origin has, box does not ---"
sudo -u hhf git log HEAD..origin/main --oneline || true
echo "--- status ---"
sudo -u hhf git status --short --branch
'

PARAMS_FILE="$(mktemp -t hhf-diagnose-params.XXXXXX.json)"
trap 'rm -f "$PARAMS_FILE"' EXIT
node -e 'process.stdout.write(JSON.stringify({commands:[process.argv[1]]}))' "$REMOTE_SCRIPT" > "$PARAMS_FILE"

CID="$(aws ssm send-command --instance-ids "$PROD_INSTANCE_ID" --document-name AWS-RunShellScript \
      --parameters "file://$PARAMS_FILE" \
      --query Command.CommandId --output text)"
[ -n "$CID" ] || { echo "✗ send-command failed — no CommandId returned"; exit 1; }
echo "▶ Command sent (${CID}), waiting…"

STATUS="InProgress"
for _ in $(seq 1 40); do
  STATUS="$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
            --query Status --output text 2>/dev/null || echo InProgress)"
  case "$STATUS" in
    Pending|InProgress|Delayed) sleep 2 ;;
    *) break ;;
  esac
done

echo "--- stdout ---"
aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
  --query StandardOutputContent --output text
echo "--- stderr ---"
aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
  --query StandardErrorContent --output text
