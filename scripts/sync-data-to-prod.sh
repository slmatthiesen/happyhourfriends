#!/usr/bin/env bash
# Copy local venue/HH data into the prod managed DB.
#
# PRE-LAUNCH ONLY. Wipes the listed data tables on prod first, then restores from local.
# Once real submissions are landing on prod (post-launch), STOP using this — submissions
# and admin actions are the data path; bulk-syncing would clobber live writes.
#
# Usage:
#   LOCAL_DATABASE_URL=postgresql://hhf:hhf@localhost:5432/happyhourfriends \
#   PROD_DATABASE_URL=postgresql://...do-managed-pg... \
#     npm run sync:to-prod
set -euo pipefail

: "${LOCAL_DATABASE_URL:?Set LOCAL_DATABASE_URL}"
: "${PROD_DATABASE_URL:?Set PROD_DATABASE_URL}"

# Order matters only for readability — TRUNCATE ... CASCADE handles FK dependents.
TABLES=(
  cities
  neighborhoods
  chains
  venues
  happy_hours
  happy_hour_exceptions
  offerings
  tags
  venue_tags
  seed_candidates
)

read -r -p "About to TRUNCATE ${#TABLES[@]} tables on prod and reload from local. Continue? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }

echo "→ Truncating tables on prod..."
TRUNCATE_LIST=$(IFS=, ; echo "${TABLES[*]}")
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "TRUNCATE ${TRUNCATE_LIST} RESTART IDENTITY CASCADE;"

echo "→ Dumping local data and piping to prod..."
DUMP_ARGS=()
for t in "${TABLES[@]}"; do DUMP_ARGS+=(-t "$t"); done

pg_dump \
  --data-only \
  --no-owner \
  --no-acl \
  --disable-triggers \
  "${DUMP_ARGS[@]}" \
  "$LOCAL_DATABASE_URL" \
  | psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction

echo "✅ Data sync complete."
