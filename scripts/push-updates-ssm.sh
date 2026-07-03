#!/usr/bin/env bash
# Update-push to the AWS prod box over SSM (port 22 is closed there — see
# scripts/sync/with-prod-tunnel-ssm.sh). Inserts NEW venues AND re-publishes existing
# venues whose local curation changed (edited windows, hidden offerings, swapped source
# URLs). Curation tables only — user data (submissions, flags, audit_log) is never
# touched, and a venue a user edited more recently on prod is skipped (prod wins).
# Defaults to a DRY RUN; add --apply to commit.
#
# Recommended: run `pnpm pull:data:upsert` first so prod's user edits are reflected
# locally before you push curation up.
#
#   AWS_PROFILE=<profile> PROD_INSTANCE_ID=<i-...> pnpm push:updates:ssm            # preview
#   AWS_PROFILE=<profile> PROD_INSTANCE_ID=<i-...> pnpm push:updates:ssm -- --apply # commit
#
# (PROD_INSTANCE_ID / AWS_PROFILE can live in the gitignored .env instead of inline.)
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh"
run_sync push-updates "$@"
