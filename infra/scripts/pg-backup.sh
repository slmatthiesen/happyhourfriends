#!/usr/bin/env bash
# Nightly Postgres backup → S3. BACKUP_BUCKET is provided via /etc/happyhour/.env.
set -euo pipefail
set -a; . /etc/happyhour/.env; set +a
ts="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp /tmp/hhf-XXXX.dump)"
trap 'rm -f "$tmp"' EXIT
pg_dump -Fc -h localhost -U hhf hhf > "$tmp"
aws s3 cp "$tmp" "s3://${BACKUP_BUCKET}/pgdump/hhf-${ts}.dump"
echo "backup uploaded: s3://${BACKUP_BUCKET}/pgdump/hhf-${ts}.dump"
