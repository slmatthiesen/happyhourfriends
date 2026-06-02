#!/usr/bin/env bash
# DEPRECATED — use `npm run push:data` (scripts/push-data-to-prod.sh) instead.
#
# This restores over a tunnel as the `hhf` role, which does NOT work against the
# real self-hosted droplet: `hhf` is not a superuser (so `--disable-triggers`
# fails) and the app's pool exhausts the non-superuser connection slots. It also
# never migrates prod's schema first. See docs/data-sync-runbook.md for the full
# story. Kept only for a hypothetical DO-Managed-PG setup where `hhf` is superuser.
set -euo pipefail

if [[ "${ALLOW_LEGACY_SYNC:-0}" != "1" ]]; then
  echo "✗ sync:to-prod is deprecated and does not work against the droplet."
  echo "  Use:  PROD_IP=<ip> npm run push:data"
  echo "  (Override with ALLOW_LEGACY_SYNC=1 only for a DO-Managed-PG / superuser setup.)"
  exit 1
fi

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
