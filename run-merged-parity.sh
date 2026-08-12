#!/usr/bin/env bash
# Deep parity runs of every reference subgraph against the MERGED endpoint.
#
# One endpoint (2a5ef57) serves five source indexers across five chains, so each
# run is identified by (indexer, chain) and needs three things the single-pair
# tool did not: an entity prefix, a chain filter, and a block pin on BOTH sides.
#
# The pins are per chain and come from the merged indexer's own
# latest_processed_block. That deployment is currently STOPPED, so the pins are
# stable; re-read them with chain-metadata.sh before trusting a fresh run.
#
# Coverage: --deep with --deep-limit 10000 means row COUNTS are exhaustive on
# every entity, and the field comparison covers at least 10,000 rows per entity
# (all of them where fewer exist). Entities that truncate are flagged in the
# report as comparisonTruncated.
#
# Usage:  ./run-merged-parity.sh [target ...]     (default: all)
# No `set -u`: bash 3.2 (the macOS default) raises "unbound variable" on ANY
# empty-array expansion, and the --chain flag is legitimately empty for the
# chain-239-only targets.
set -o pipefail

cd "$(dirname "$0")"

HYPERINDEX_URL='https://indexer.dev.hyperindex.xyz/2a5ef57/v1/graphql'
MERGED_SCHEMA='./pumex-merged/hyperindex-schema.graphql'
GOLDSKY='https://api.goldsky.com/api/public/project_cltyhthusbmxp01s95k9l8a1u/subgraphs'
ORMI='https://api.subgraph.ormilabs.com/api/public/414271d5-5c72-4403-ac1e-fabd86621904/subgraphs'

THROTTLE_MS="${THROTTLE_MS:-300}"
DEEP_LIMIT="${DEEP_LIMIT:-10000}"
OUTDIR='./output/merged'

# name|subgraph url|subgraph schema|overrides|prefix|chain(-=none)|pin
TARGETS=(
"helper-1776|$ORMI/pumex-helper/v0.0.2/gn|./pumex-helper/subgraph-schema.1776.graphql|./pumex-helper/overrides.json|Helper_|1776|178217185"
"farm-239|$GOLDSKY/farms-tac/v1.0.0/gn|./pumex-farming/subgraph-schema.introspected.graphql|./pumex-farming/overrides.json|Farm_|-|24087877"
"analytics-239|$GOLDSKY/cl-analytics-tac/v1.0.1/gn|./pumex-cl-analytics/subgraph-schema.introspected.graphql|./pumex-cl-analytics/overrides.json|Analytics_|-|24087877"
"v1-4663|$GOLDSKY/v1-orvex/1.0.0/gn|./pumex-v1/subgraph-schema.4663.graphql|./pumex-v1/overrides.json|V1_|4663|34068305"
"helper-4663|$GOLDSKY/orvex-helper/1.0.1/gn|./pumex-helper/subgraph-schema.4663.graphql|./pumex-helper/overrides.json|Helper_|4663|34068305"
"helper-9745|$GOLDSKY/ionex-helper/0.3/gn|./pumex-helper/subgraph-schema.9745.graphql|./pumex-helper/overrides.json|Helper_|9745|29553607"
"v1-59144|$GOLDSKY/lynex-v1/1.0.4/gn|./pumex-v1/subgraph-schema.59144.graphql|./pumex-v1/overrides.json|V1_|59144|31696749"
"helper-59144|$GOLDSKY/lynex-helper/0.0.2/gn|./pumex-helper/subgraph-schema.59144.graphql|./pumex-helper/overrides.json|Helper_|59144|31696749"
)

mkdir -p "$OUTDIR"

selected=("$@")
for spec in "${TARGETS[@]}"; do
  IFS='|' read -r name url sgschema overrides prefix chain pin <<< "$spec"

  if [ ${#selected[@]} -gt 0 ]; then
    match=0
    for a in "${selected[@]}"; do [ "$a" = "$name" ] && match=1; done
    [ $match -eq 1 ] || continue
  fi

  # Analytics_* and Farm_* are chain-239-only and carry BARE ids, so they run
  # with no --chain at all. Passing one would filter on a "239-" prefix that
  # those tables never had, and every row would read as missing.
  chainflag=()
  [ "$chain" != "-" ] && chainflag=(--chain "$chain")

  echo "=============================================================="
  echo "RUN $name   prefix=$prefix chain=$chain pin=$pin"
  echo "  subgraph: $url"
  echo "=============================================================="

  SUBGRAPH_URL="$url" \
  HYPERINDEX_URL="$HYPERINDEX_URL" \
  SUBGRAPH_SCHEMA="$sgschema" \
  HYPERINDEX_SCHEMA="$MERGED_SCHEMA" \
  OVERRIDES_PATH="$overrides" \
  npx tsx src/index.ts \
    --deep --deep-limit "$DEEP_LIMIT" --throttle-ms "$THROTTLE_MS" \
    --entity-prefix "$prefix" "${chainflag[@]}" \
    --end-block "$pin" --hyperindex-max-block "$pin" \
    --output "$OUTDIR/$name.json" \
    2>&1 | grep -vE 'DeprecationWarning|trace-deprecation'

  echo "exit=${PIPESTATUS[0]} for $name"
done
