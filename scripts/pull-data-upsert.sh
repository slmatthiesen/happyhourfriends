#!/usr/bin/env bash
# Refresh local FROM prod — non-destructive upsert (the nightly-safe pull).
#
# Unlike pull:data (which pg_restore --clean wipes + reloads local, destroying any
# city you've staged locally but not pushed), this upserts every prod row into local
# by primary key: inserts rows users added on prod, updates ones they edited, and
# NEVER deletes local-only rows. Safe to run on a nightly cron mid-curation.
# Scope = venue/curation tables only (not edit_submissions/flags/audit_log — use the
# full pull:data when you need those locally). See docs/data-sync-runbook.md.
#
# Defaults to a DRY RUN. Add --apply to commit.
#   PROD_IP=203.0.113.10 npm run pull:data:upsert            # preview
#   PROD_IP=203.0.113.10 npm run pull:data:upsert -- --apply # commit
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel.sh"
run_sync pull "$@"
