#!/usr/bin/env bash
# Propagate local SOFT-DELETIONS up to prod — the deletion counterpart to push:data:additive.
#
# additive push only ever INSERTs, so a venue you removed locally (e.g. a family_restaurant
# stub via delete:empty-cuisine-stubs) lives on forever on prod. This soft-deletes on prod
# every venue that is soft-deleted locally, matched by google_place_id. Non-destructive:
# soft-delete only (sets deleted_at + deactivates that venue's happy_hours), reversible,
# idempotent, and it never touches user-contributed data.
#
# Defaults to a DRY RUN. Add --apply to commit.
#   PROD_IP=203.0.113.10 npm run push:deletions            # preview (counts only)
#   PROD_IP=203.0.113.10 npm run push:deletions -- --apply # commit
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel.sh"
run_sync delete-venues "$@"
