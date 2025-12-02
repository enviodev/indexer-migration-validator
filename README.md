# Subgraph vs HyperIndex Comparison Tool

A TypeScript CLI tool for validating data correctness when migrating from TheGraph subgraphs to Envio HyperIndex indexers.

## Overview

This tool queries both a subgraph and a HyperIndex endpoint, compares the returned data, and reports any differences. It's designed to help verify that a migrated indexer produces identical results to the original subgraph.

## Features

- **Sample Mode**: Quick comparison using random samples (default)
- **Deep Mode**: Full comparison with pagination for thorough validation
- **Field-level diffing**: Shows exact field differences with percentage variance for numeric fields
- **Progress tracking**: Live progress updates during deep comparisons
- **JSON reports**: Detailed diff reports saved to files
- **Flexible filtering**: Compare specific entities or all entities

## Installation

```bash
pnpm install
```

## Usage

### Basic Commands

```bash
# Compare all entities with default sample size (50)
pnpm compare

# Compare specific entity
pnpm compare --entity Pool

# Increase sample size
pnpm compare --sample 200

# Deep comparison (fetch ALL records)
pnpm compare --deep --entity Pool

# Deep comparison with limit
pnpm compare --deep-limit 1000 --entity CollectionToken

# Skip JSON report generation
pnpm compare --no-json

# Show help
pnpm compare --help
```

### Options

| Option | Description |
|--------|-------------|
| `--entity <name>` | Compare only the specified entity |
| `--sample <n>` | Number of random samples per entity (default: 50) |
| `--deep` | Deep comparison: fetch ALL records using pagination |
| `--deep-limit <n>` | Deep comparison with max N records per entity |
| `--output <path>` | Custom output path for JSON report |
| `--no-json` | Skip JSON report generation |
| `--help, -h` | Show help |

### Examples

```bash
# Quick validation of Pool entity
pnpm compare --entity Pool --sample 100

# Full validation of all Pool records
pnpm compare --deep --entity Pool

# Compare multiple entities with larger sample
pnpm compare --sample 200

# Deep compare with limit to avoid long runtimes
pnpm compare --deep-limit 5000
```

## Configuration

Edit `src/config.ts` to configure:

### Endpoints

```typescript
export const SUBGRAPH_URL = 'https://your-subgraph-endpoint';
export const HYPERINDEX_URL = 'https://your-hyperindex-endpoint/v1/graphql';
```

### Entity Configuration

Each entity needs configuration mapping between subgraph and HyperIndex naming conventions:

```typescript
export const ENTITY_CONFIGS = {
  Pool: {
    subgraphName: 'pools',           // Subgraph query name (plural, camelCase)
    hyperindexName: 'Pool',          // HyperIndex query name (PascalCase)
    fields: ['id', 'sqrtPriceX96', 'tick', 'volumeETH'],  // Fields to compare
    nestedFields: {
      'collectionToken': 'collectionToken_id'  // Subgraph nested -> HyperIndex flat
    },
    fieldMapping: {},                // Optional: rename fields between systems
    knownIdMismatch: false           // Set true if ID formats differ
  },
  // ... more entities
};
```

### Key Differences Handled

| Subgraph | HyperIndex |
|----------|------------|
| `first: N` | `limit: N` |
| `skip: N` | `offset: N` |
| `orderBy: field` | `order_by: {field: asc}` |
| `where: {id_in: [...]}` | `where: {id: {_in: [...]}}` |
| `entity { id }` (nested) | `entity_id` (flat) |

## Output

### Console Output

Shows colored diff output with:
- Entity summary (record counts, match/mismatch stats)
- Field-level differences with values from both sources
- Percentage differences for numeric fields
- Missing IDs in either direction (deep mode)

### JSON Reports

Saved to `output/comparison-YYYY-MM-DD_HH-MM-SS.json` with full diff details:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "totalEntities": 14,
    "entitiesWithDifferences": 5,
    "totalMatched": 500,
    "totalMismatched": 100
  },
  "entities": [
    {
      "entityName": "Pool",
      "subgraphCount": 34136,
      "hyperindexCount": 34136,
      "matchedCount": 34136,
      "mismatchedCount": 0,
      "fieldMismatches": []
    }
  ]
}
```

## Adapting for Other Migrations

To use this tool for a different subgraph migration:

1. **Update endpoints** in `src/config.ts`
2. **Configure entities** by adding entries to `ENTITY_CONFIGS`:
   - Map subgraph plural names to HyperIndex singular names
   - List fields to compare
   - Map nested fields to flat foreign key fields
3. **Handle ID mismatches**: Set `knownIdMismatch: true` for entities where ID generation differs
4. **Run comparison** and iterate on fixes

## Known Limitations

- Maximum 100k records per entity in deep mode (safety limit)
- Nested object comparisons limited to ID extraction
- Array fields not fully supported yet

## Troubleshooting

### "No common IDs found"

Either:
- The entity has no data in one or both sources
- ID formats differ between systems (set `knownIdMismatch: true`)

### Timeout errors

- Reduce sample size or use `--deep-limit`
- Check endpoint connectivity

### Field not found errors

- Verify field names match between schema and config
- Check for renamed fields in HyperIndex schema
