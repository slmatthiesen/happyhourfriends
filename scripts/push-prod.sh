#!/usr/bin/env bash
# push:prod — the one command to push local curation up to the AWS prod box.
#
# Wraps the SSM "update-push" (scripts/push-updates-ssm.sh): inserts NEW venues and
# re-publishes existing venues whose local curation changed (neighborhood assignments,
# edited windows, hidden offerings, swapped source URLs). Curation tables only — user data
# (submissions, flags, audit_log) is never touched, and any venue a user edited more
# recently on prod is SKIPPED (prod wins). Full guide: docs/pushing-data-to-prod.md.
#
#   pnpm push:prod            # PREVIEW (dry run — writes nothing)
#   pnpm push:prod -- --apply # commit
#   pnpm push:prod -- --full  # PREVIEW a FULL reconcile: every venue where local differs from
#                             # prod, ignoring the last-push watermark. Use this to flush
#                             # curation stranded before the watermark (add --apply to commit).
#                             # Slower (diffs all venues); the first run clears the backlog.
#   pnpm push:prod -- --full --city san-francisco --state CA
#                             # Scope the flush to ONE city — tractable, observable chunks with
#                             # live N/total progress. A scoped run does NOT advance the global
#                             # watermark (it only covered one city).
#
# One-time setup — put these in your gitignored .env (NEVER committed; this is a public repo):
#   PROD_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx   # EC2 prod box instance id
#   AWS_PROFILE=<profile>                  # AWS profile with SSM + Secrets Manager access
# AWS_REGION defaults to us-east-1, PROD_SECRET_ID to budget/secrets. The prod DB password
# is read from AWS Secrets Manager at run time — never stored on disk or in git.
set -euo pipefail

# Friendly preflight so a missing identifier points at the setup, not a raw bash `:?` error.
if [ -f ./.env ]; then set -a; source ./.env; set +a; fi
missing=()
[ -n "${PROD_INSTANCE_ID:-}" ] || missing+=(PROD_INSTANCE_ID)
[ -n "${AWS_PROFILE:-}" ] || missing+=(AWS_PROFILE)
if [ "${#missing[@]}" -gt 0 ]; then
  echo "✗ push:prod needs: ${missing[*]}"
  echo "  Add to your gitignored .env (see docs/pushing-data-to-prod.md):"
  echo "    PROD_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx"
  echo "    AWS_PROFILE=<your-aws-profile>"
  exit 1
fi

case " $* " in
  *" --apply "*) echo "▶ push:prod — APPLYING to prod (${PROD_INSTANCE_ID})…" ;;
  *) echo "▶ push:prod — PREVIEW only (dry run, writes nothing). Re-run with  -- --apply  to commit." ;;
esac

source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh"
run_sync push-updates "$@"
