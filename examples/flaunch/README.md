# Flaunch Protocol Migration Example

This example shows a real-world migration of the Flaunch protocol from TheGraph subgraph to Envio HyperIndex.

## Overview

- **Entities**: 66 entity types
- **Source**: Flaunch Base Mainnet Subgraph
- **Target**: Envio HyperIndex

## Files

- `subgraph-schema.graphql` - The original Flaunch subgraph schema
- `hyperindex-schema.graphql` - The migrated HyperIndex schema
- `overrides.json` - Field mappings and known ID mismatches

## Usage

To use this example:

```bash
# From the project root
pnpm compare \
  --subgraph-schema examples/flaunch/subgraph-schema.graphql \
  --hyperindex-schema examples/flaunch/hyperindex-schema.graphql
```

You'll also need to set the endpoint URLs in your `.env` file:

```env
SUBGRAPH_URL=<your-flaunch-subgraph-endpoint>
HYPERINDEX_URL=<your-flaunch-hyperindex-endpoint>
OVERRIDES_PATH=examples/flaunch/overrides.json
```

## Field Mappings

The `overrides.json` contains field mappings for cases where field names differ:

- `CollectionToken.native` → `isNative`
- `PoolSwap.type` → `swapType`
- `Activity.type` → `activityType`
- Various OHLC fields renamed with `price` prefix

## Known ID Mismatches

Some entities have different ID generation strategies between subgraph and HyperIndex:

- `CollectionTokenHolding`
- `CollectionTokenHoldingChange`
- `PoolSwap`
- `Activity`

These are configured in `knownIdMismatch` and will be skipped during deep comparisons.
