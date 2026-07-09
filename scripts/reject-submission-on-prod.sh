#!/usr/bin/env bash
# Mark ONE submission 'rejected' on prod — the reject counterpart to publish-venue-to-prod.sh.
# A reject in local /admin only writes the local row, so without this prod keeps the row
# queued_admin and it reappears on every pull:queue. Touches only edit_submissions.
# Called by the local /admin Reject action, and usable directly. Defaults to a DRY RUN;
# the server action passes --apply.
#   pnpm reject:submission -- --submission <id> --apply
# Needs PROD_INSTANCE_ID + AWS_PROFILE in .env (see docs/pushing-data-to-prod.md).
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh"
run_sync reject-submission "$@"
