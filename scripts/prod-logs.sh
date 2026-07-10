#!/usr/bin/env bash
# prod-logs — pull recent hhf-web (app + pg-boss workers) logs from the prod box.
# READ-ONLY: runs `journalctl -u hhf-web` over an SSM RunCommand and prints the output.
# The AWS EC2 box has port 22 closed, so the old `ssh root@… journalctl` no longer works.
#
#   bash scripts/prod-logs.sh [LINES] [GREP]
#     LINES  how many recent journal lines to fetch (default 150)
#     GREP   optional case-insensitive filter (e.g. Error, submissions, sharp)
#
# .env needs (same as deploy:prod): PROD_INSTANCE_ID, AWS_PROFILE (+ optional AWS_REGION).
set -euo pipefail
export AWS_PAGER=""

if [ -f ./.env ]; then set -a; source ./.env; set +a; fi
LINES="${1:-150}"
FILTER="${2:-}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
: "${PROD_INSTANCE_ID:?set PROD_INSTANCE_ID in .env}"
: "${AWS_PROFILE:?set AWS_PROFILE in .env}"

# journalctl runs as root under SSM RunCommand, so no sudo needed. Filter on the box to
# keep the returned payload small.
if [ -n "$FILTER" ]; then
  REMOTE="journalctl -u hhf-web -n 2000 --no-pager | grep -i -- '$FILTER' | tail -n $LINES"
else
  REMOTE="journalctl -u hhf-web -n $LINES --no-pager"
fi

PARAMS_FILE="$(mktemp -t hhf-logs.XXXXXX.json)"
trap 'rm -f "$PARAMS_FILE"' EXIT
node -e 'process.stdout.write(JSON.stringify({commands:[process.argv[1]]}))' "$REMOTE" > "$PARAMS_FILE"

CID="$(aws ssm send-command --instance-ids "$PROD_INSTANCE_ID" --document-name AWS-RunShellScript \
      --parameters "file://$PARAMS_FILE" --query Command.CommandId --output text)"
for _ in $(seq 1 30); do
  S="$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
       --query Status --output text 2>/dev/null || echo InProgress)"
  case "$S" in Pending|InProgress|Delayed) sleep 2 ;; *) break ;; esac
done
aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
  --query StandardOutputContent --output text
