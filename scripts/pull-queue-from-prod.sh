#!/usr/bin/env bash
# Pull prod's queued_admin submission leftovers DOWN to local for review in /admin.
# Non-destructive upsert by id; never deletes. Defaults to a DRY RUN; add --apply.
#   PROD_IP=203.0.113.10 npm run pull:queue            # preview
#   PROD_IP=203.0.113.10 npm run pull:queue -- --apply # commit
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel.sh"
run_sync pull-queue "$@"
