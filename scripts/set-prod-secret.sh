#!/usr/bin/env bash
# set-prod-secret — push ONE key from your local .env up to prod, end to end:
#   1. write the value into AWS Secrets Manager (`budget/secrets`) — the source of truth.
#   2. re-render just that one line in the box's /etc/happyhour/.env and restart hhf-web.
#
# Why step 2 is needed: the box renders /etc/happyhour/.env from Secrets Manager only at
# PROVISION time. `deploy:prod` sources the existing file; it does NOT re-pull secrets. So
# a secret you change in the console/CLI never reaches the running app until this runs.
#
# The secret VALUE is never printed and never travels in the SSM command text: the box
# fetches it from Secrets Manager itself (its instance role has GetSecretValue), so the key
# stays off your terminal and out of the SSM/CloudTrail command log.
#
#   bash scripts/set-prod-secret.sh [KEY_NAME]      # KEY_NAME defaults to ANTHROPIC_API_KEY
#
# .env needs (same as deploy:prod): PROD_INSTANCE_ID, AWS_PROFILE (+ optional AWS_REGION,
# PROD_SECRET_ID which defaults to budget/secrets).
set -euo pipefail
export AWS_PAGER=""

if [ -f ./.env ]; then set -a; source ./.env; set +a; fi
KEYNAME="${1:-ANTHROPIC_API_KEY}"
SECRET_ID="${PROD_SECRET_ID:-budget/secrets}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
: "${PROD_INSTANCE_ID:?set PROD_INSTANCE_ID in .env}"
: "${AWS_PROFILE:?set AWS_PROFILE in .env}"

LOCAL_VAL="$(printenv "$KEYNAME" || true)"
[ -n "$LOCAL_VAL" ] || { echo "✗ $KEYNAME is empty/absent in local .env"; exit 1; }
echo "▶ Pushing $KEYNAME (len ${#LOCAL_VAL}) to prod — value is never printed."

# 1. Secrets Manager: merge just this one key into the existing secret. The full secret
#    JSON only ever lives in a shell var and a pipe — never on screen. The value is passed
#    to jq via the environment (not argv), so it isn't visible in `ps`.
current="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)"
printf '%s' "$current" \
  | KEYNAME="$KEYNAME" VAL="$LOCAL_VAL" jq '.[env.KEYNAME] = env.VAL' \
  | aws secretsmanager put-secret-value --secret-id "$SECRET_ID" \
        --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
echo "  ✓ Secrets Manager updated"

# 2. Re-render the one line on the box + restart. KEYNAME/SECRET_ID/REGION are interpolated
#    from the local shell (safe tokens); the runtime vars ($NEWKEY, $tmp) are escaped so they
#    evaluate ON the box. The value is fetched there, so it never leaves the instance.
REMOTE_SCRIPT="$(cat <<EOF
set -eu
NEWKEY="\$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --region $AWS_REGION --query SecretString --output text | jq -r '.["$KEYNAME"]')"
[ -n "\$NEWKEY" ] && [ "\$NEWKEY" != "null" ] || { echo "ERROR: $KEYNAME empty in Secrets Manager"; exit 1; }
tmp="\$(mktemp)"
grep -v "^$KEYNAME=" /etc/happyhour/.env > "\$tmp" || true
printf '$KEYNAME=%s\n' "\$NEWKEY" >> "\$tmp"
install -o root -g hhf -m 640 "\$tmp" /etc/happyhour/.env
rm -f "\$tmp"
systemctl restart hhf-web
sleep 3
systemctl is-active --quiet hhf-web && echo "hhf-web: active" || { echo "hhf-web: NOT active"; exit 1; }
EOF
)"

# A real JSON params file (not commands=[...] shorthand) so the multiline script isn't
# double-wrapped — same reason deploy-prod.sh does it this way.
PARAMS_FILE="$(mktemp -t hhf-setsecret.XXXXXX.json)"
trap 'rm -f "$PARAMS_FILE"' EXIT
node -e 'process.stdout.write(JSON.stringify({commands:[process.argv[1]]}))' "$REMOTE_SCRIPT" > "$PARAMS_FILE"

CID="$(aws ssm send-command --instance-ids "$PROD_INSTANCE_ID" --document-name AWS-RunShellScript \
      --parameters "file://$PARAMS_FILE" --timeout-seconds 120 \
      --query Command.CommandId --output text)"
[ -n "$CID" ] || { echo "✗ send-command failed — no CommandId"; exit 1; }
echo "▶ Box command sent ($CID), waiting…"

STATUS="InProgress"
for _ in $(seq 1 40); do
  STATUS="$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
            --query Status --output text 2>/dev/null || echo InProgress)"
  case "$STATUS" in Pending|InProgress|Delayed) sleep 3 ;; *) break ;; esac
done

echo "--- box output ---"
aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
  --query StandardOutputContent --output text
err="$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$PROD_INSTANCE_ID" \
       --query StandardErrorContent --output text)"
[ -n "$err" ] && { echo "--- stderr ---"; echo "$err"; } || true

[ "$STATUS" = "Success" ] && echo "✓ $KEYNAME pushed to prod; hhf-web restarted." \
  || { echo "✗ box step ended: $STATUS"; exit 1; }
