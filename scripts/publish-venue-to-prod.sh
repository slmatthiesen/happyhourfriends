#!/usr/bin/env bash
# Publish ONE locally-approved venue (subtree) UP to prod by PK upsert, and flip its
# prod submission to 'applied'. Called by the local /admin Apply/Revert actions, and
# usable directly for a fast single-venue push instead of the full push:prod sweep.
# Defaults to a DRY RUN; the server action passes --apply.
#   pnpm publish:venue -- --venue <id> --submission <id> --apply
# Needs PROD_INSTANCE_ID + AWS_PROFILE in .env (see docs/pushing-data-to-prod.md).
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh"
run_sync publish-venue "$@"
