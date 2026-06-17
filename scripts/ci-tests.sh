#!/usr/bin/env bash
#
# Hermetic unit-test suite — the set CI runs on every PR.
#
# Every test listed here was verified to pass with DATABASE_URL and all secret keys
# UNSET, so it needs no live database, API key, or network. Tests that DO need those
# are intentionally excluded (run them locally against a real DB / keys):
#   - test:email                 (needs RESEND_API_KEY)
#   - test:assignment            (needs a live Postgres/PostGIS)
#   - test:name-primary          (needs a live Postgres/PostGIS)
#   - test:dedup-assignment      (needs a live Postgres/PostGIS)
#   - test:db-sync               (needs a live Postgres; creates scratch DBs)
#   - test:contribution-pipeline (needs a live DB + ANTHROPIC_API_KEY)
#   - test:discovery-coverage    (makes live outbound fetches)
#
# When you add a new pure-logic test, add its `test:<name>` script here.
# Runs them all and reports every failure (does not stop at the first).

set -uo pipefail

TESTS=(
  test:venue-type
  test:neighborhood-canonical
  test:first-party
  test:source-provenance
  test:menu-platform
  test:venue-quality
  test:harvest
  test:striphtml-sections
  test:section-scoping-fixtures
  test:hidden-review
  test:review-siblings
  test:stub-rank
  test:extract
  test:realness-gate
  test:jsonld-menu
  test:window-reconcile
  test:anomaly-rules
  test:flag-eval
  test:evidence-cleanup
  test:render-escalation
  test:site-triage
  test:format
  test:active
  test:hours
  test:resolve
  test:format-by-day
  test:reverify
  test:reverify-parse
  test:reverify-report
  test:distance
  test:maps-link
  test:recognizability
  test:revalidate
  test:route-contribution
  test:interpreter-newhh
  test:queued-email
  test:safesearch
  test:evidence-relevance
  test:cardinal-districts
  test:hh-text
  test:hh-relevance
  test:normalize-url
  test:hh-signal-gate
  test:extract-time
  test:sitemap
  test:routes
  test:parse-hh-text
  test:free-extract
  test:hh-outcomes
  test:hh-golden
  test:resolve-city
  test:offering-sanity
  test:own-site-hh-priority
  test:own-site-hh-probe
  test:persist-unified
  test:adjudicate-flag
  test:machine-text
  test:map-concurrency
  test:manual-window
  test:neighborhood-name
  test:group-by-state
)

failed=()
for t in "${TESTS[@]}"; do
  echo "── $t ──────────────────────────────────────────"
  if npm run --silent "$t"; then
    :
  else
    failed+=("$t")
  fi
done

echo
if [ ${#failed[@]} -ne 0 ]; then
  echo "✗ ${#failed[@]} suite(s) FAILED: ${failed[*]}"
  exit 1
fi
echo "✓ all ${#TESTS[@]} hermetic test suites passed."
