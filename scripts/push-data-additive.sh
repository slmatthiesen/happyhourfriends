#!/usr/bin/env bash
# Push NEW venues curated locally UP to prod — additive, NON-destructive.
#
# Unlike push:data (a pre-launch full-reload that TRUNCATEs), this only INSERTs venues
# whose google_place_id/id don't already exist on prod, plus their happy-hours/
# offerings/tags and any missing cities/neighbourhoods/chains/tags. It never modifies
# an existing prod venue, so user-contributed edits are safe. Use it post-launch to
# promote a city you onboarded locally. See docs/data-sync-runbook.md.
#
# Defaults to a DRY RUN. Add --apply to commit.
#   PROD_IP=203.0.113.10 npm run push:data:additive            # preview
#   PROD_IP=203.0.113.10 npm run push:data:additive -- --apply # commit
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel.sh"
run_sync push "$@"
