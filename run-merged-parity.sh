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

# Override per run: the endpoint changes with every redeploy, and every
# redeploy re-indexes from scratch.
HYPERINDEX_URL="${HYPERINDEX_URL:-https://indexer.dev.hyperindex.xyz/8f7107f/v1/graphql}"
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
# Analytics ids became `${chainId}-` prefixed when Plasma was added, so this
# target now runs WITH --chain. It used to be `-`. Farm_ is still bare.
"analytics-239|$GOLDSKY/cl-analytics-tac/v1.0.1/gn|./pumex-cl-analytics/subgraph-schema.introspected.graphql|./pumex-cl-analytics/overrides.json|Analytics_|239|24087877"
"v1-4663|$GOLDSKY/v1-orvex/1.0.0/gn|./pumex-v1/subgraph-schema.4663.graphql|./pumex-v1/overrides.json|V1_|4663|34068305"
"helper-4663|$GOLDSKY/orvex-helper/1.0.1/gn|./pumex-helper/subgraph-schema.4663.graphql|./pumex-helper/overrides.json|Helper_|4663|34068305"
"helper-9745|$GOLDSKY/ionex-helper/0.3/gn|./pumex-helper/subgraph-schema.9745.graphql|./pumex-helper/overrides.json|Helper_|9745|29553607"
"v1-59144|$GOLDSKY/lynex-v1/1.0.4/gn|./pumex-v1/subgraph-schema.59144.graphql|./pumex-v1/overrides.json|V1_|59144|31696749"
"helper-59144|$GOLDSKY/lynex-helper/0.0.2/gn|./pumex-helper/subgraph-schema.59144.graphql|./pumex-helper/overrides.json|Helper_|59144|31696749"
# Added 2026-08-13: references supplied that were previously "no URL on file".
# v4-1776 in particular was recorded as "never had a URL", so v4 is no longer
# wholly unvalidatable — only v4/4663 is, since v4-orvex still 404s.
"v1-239|$GOLDSKY/v1-snap/0.1/gn|./pumex-v1/subgraph-schema.239.graphql|./pumex-v1/overrides.json|V1_|239|0"
"v1-9745|$GOLDSKY/v1-ionex/0.2/gn|./pumex-v1/subgraph-schema.9745.graphql|./pumex-v1/overrides.json|V1_|9745|0"
"v1-1776|$ORMI/pumex-v1/v0.0.1/gn|./pumex-v1/subgraph-schema.1776.graphql|./pumex-v1/overrides.json|V1_|1776|0"
"v4-1776|$ORMI/pumex-v4cl-main/v1.0.1/gn|./pumex-v4/subgraph-schema.1776.graphql|./pumex-v4/overrides.json|V4_|1776|0"
# Added 2026-08-13 with the analytics chain-prefix change. This reference is
# EMPTY and expected to stay that way: factory 0x51f563…d151 has emitted
# DefaultCommunityFee(500) and nothing else, poolCount 0. A pass is
# Analytics_Factory / Bundle / BurnFeeCache / SwapFeeCache /
# PositionTransferCache at 1/1 each, every other entity 0/0, 0 field diffs.
# Its schema introspects byte-identical to cl-analytics-tac's, so the same
# introspected file is reused deliberately.
"analytics-9745|$GOLDSKY/analytics-plasma/v1.0.0/gn|./pumex-cl-analytics/subgraph-schema.introspected.graphql|./pumex-cl-analytics/overrides.json|Analytics_|9745|0"
)

mkdir -p "$OUTDIR"

# Per-chain pins, read from the deployment itself rather than hardcoded. A
# hardcoded pin silently becomes wrong the moment the indexer is redeployed or
# resumes advancing, and the failure mode is that the subgraph's newer rows all
# read as "missing in envio".
echo "Reading pins from $HYPERINDEX_URL ..."
PINS_JSON=$(curl -s -X POST "$HYPERINDEX_URL" \
  -H 'content-type: application/json' -H 'User-Agent: parity/1.0' \
  --data '{"query":"{ chain_metadata { chain_id latest_processed_block } }"}')
pin_for() {
  echo "$PINS_JSON" | python3 -c "
import json,sys
cid=int(sys.argv[1])
d=json.load(sys.stdin)
for r in d['data']['chain_metadata']:
    if r['chain_id']==cid: print(r['latest_processed_block']); break
else: print('')
" "$1"
}

selected=("$@")
for spec in "${TARGETS[@]}"; do
  IFS='|' read -r name url sgschema overrides prefix chain staticpin <<< "$spec"

  # Chain-239-only targets carry no --chain, so derive the pin chain from the
  # target name instead.
  pinchain="$chain"
  [ "$pinchain" = "-" ] && pinchain="${name##*-}"
  envio_pin=$(pin_for "$pinchain")
  if [ -z "$envio_pin" ]; then
    echo "!! no pin for chain $pinchain on this deployment; skipping $name"
    continue
  fi
  # Pin at min(envio head, subgraph head). The deployment is live again rather
  # than frozen, and on some chains it now runs AHEAD of its reference — a pin
  # past the subgraph's head makes it reject every query with "has only indexed
  # up to block N", which the runner records as an entity with zero rows and
  # therefore as a spuriously clean result.
  sg_pin=$(curl -s -m 30 -X POST "$url" \
    -H 'content-type: application/json' -H 'User-Agent: parity/1.0' \
    --data '{"query":"{ _meta { block { number } } }"}' \
    | python3 -c "import json,sys
try: print(json.load(sys.stdin)['data']['_meta']['block']['number'])
except Exception: print('')")
  #
  # Capping to the subgraph's _meta head is NOT sufficient on its own. That head
  # is what the subgraph has INGESTED; its time-travel queries can still refuse a
  # block a little below it, and both sides keep advancing between the moment the
  # pin is read and the moment the last entity is queried. On 2026-08-13
  # helper-1776 was pinned at 178,452,971 against an Ormi subgraph that answered
  # "has only indexed up to block number 178,452,955" for EVERY entity — 19 of 19
  # errored, each was recorded as zero rows, and the run wrote a report with
  # totalEntities 0 and exited 0. A completely clean-looking pass that compared
  # nothing. Hence: take the true minimum, then back off a margin.
  #
  # The margin costs only the newest few blocks, and both sides are pinned to the
  # same number, so it cannot mask a real difference — it only avoids the race.
  PIN_MARGIN="${PIN_MARGIN:-200}"
  if [ -n "$sg_pin" ] && [ "$sg_pin" -lt "$envio_pin" ]; then
    pin="$sg_pin"
    echo "   pin capped to subgraph head $sg_pin (envio at $envio_pin)"
  else
    pin="$envio_pin"
  fi
  if [ "$pin" -gt "$PIN_MARGIN" ]; then
    pin=$((pin - PIN_MARGIN))
    echo "   pin backed off ${PIN_MARGIN} blocks to $pin (both sides still advancing)"
  fi

  if [ ${#selected[@]} -gt 0 ]; then
    match=0
    for a in "${selected[@]}"; do [ "$a" = "$name" ] && match=1; done
    [ $match -eq 1 ] || continue
  fi

  # `chain=-` means the target's ids are BARE — no --chain, because passing one
  # would filter on a "239-" prefix those tables never had and every row would
  # read as missing. Only Farm_ is in that state now; Analytics_ was prefixed
  # when Plasma was added.
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

  rc=${PIPESTATUS[0]}
  echo "exit=$rc for $name"

  # A report with zero entities is NEVER a pass — it means every entity query
  # failed (see the pin note above) and the runner dutifully recorded each as
  # "0 rows, no differences". Left unchecked that flows all the way into the
  # published artifact as a clean row. Fail loudly instead.
  python3 - "$OUTDIR/$name.json" "$name" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
try:
    s = json.load(open(path))["summary"]
except Exception as e:
    print(f"!! {name}: report unreadable ({e}) — TREAT AS FAILED"); sys.exit(0)
if s.get("totalEntities", 0) == 0:
    print(f"!! {name}: EMPTY REPORT — 0 entities compared. This is NOT a pass.")
    print(f"!! Almost always a pin past the subgraph's servable head; retry with")
    print(f"!! a bigger PIN_MARGIN (currently {__import__('os').environ.get('PIN_MARGIN','200')}).")
elif s.get("totalSubgraphRecords", 0) == 0 and s.get("totalHyperindexRecords", 0) == 0:
    print(f"!! {name}: 0 rows on BOTH sides across {s['totalEntities']} entities —")
    print(f"!! vacuous. Genuine only if the reference really is empty.")
PY
done
