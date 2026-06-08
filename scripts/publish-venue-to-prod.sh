#!/usr/bin/env bash
# Publish ONE locally-approved venue (subtree) UP to prod by PK upsert, and flip its
# prod submission to 'applied'. Called by the local /admin Apply/Revert actions.
# Defaults to a DRY RUN; the server action passes --apply.
#   PROD_IP=203.0.113.10 bash scripts/publish-venue-to-prod.sh --venue <id> --submission <id> --apply
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel.sh"
run_sync publish-venue "$@"
