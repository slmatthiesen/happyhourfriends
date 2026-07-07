#!/usr/bin/env bash
# Pull prod's queued_admin submission leftovers DOWN to local for review in /admin.
# Non-destructive upsert by id; never deletes. Defaults to a DRY RUN; add --apply.
#   pnpm pull:queue            # preview
#   pnpm pull:queue -- --apply # commit
# Needs PROD_INSTANCE_ID + AWS_PROFILE in .env (see docs/pushing-data-to-prod.md).
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh"
run_sync pull-queue "$@"
