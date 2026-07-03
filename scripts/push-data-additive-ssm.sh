#!/usr/bin/env bash
# Additive push to the AWS prod box over SSM (port 22 is closed there — see
# scripts/sync/with-prod-tunnel-ssm.sh). INSERT-only: never modifies an existing prod
# venue, so user edits are safe. Defaults to a DRY RUN; add --apply to commit.
#
#   AWS_PROFILE=<profile> PROD_INSTANCE_ID=<i-...> pnpm push:data:additive:ssm            # preview
#   AWS_PROFILE=<profile> PROD_INSTANCE_ID=<i-...> pnpm push:data:additive:ssm -- --apply # commit
#
# (PROD_INSTANCE_ID / AWS_PROFILE can live in the gitignored .env instead of inline.)
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel-ssm.sh"
run_sync push "$@"
