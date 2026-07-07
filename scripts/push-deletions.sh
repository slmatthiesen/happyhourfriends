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
#   pnpm push:deletions            # preview (counts only)
#   pnpm push:deletions -- --apply # commit
# Needs PROD_INSTANCE_ID + AWS_PROFILE in .env (see docs/pushing-data-to-prod.md).
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh"
run_sync delete-venues "$@"
