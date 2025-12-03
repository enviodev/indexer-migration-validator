# Indexer Migration Validator

A TypeScript CLI tool for validating data correctness when migrating from TheGraph subgraphs to Envio HyperIndex indexers.

## Overview

This tool queries both a subgraph and a HyperIndex endpoint, compares the returned data, and reports any differences. It's designed to help verify that a migrated indexer produces identical results to the original subgraph.

## Features

- **Schema-driven**: Automatically generates entity configs from GraphQL schema files
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

## Quick Start

1. **Set up your environment** - Copy `.env.example` to `.env` and configure your endpoints:
   ```bash
   cp .env.example .env
   ```

2. **Add your schema files** - Place your GraphQL schema files in the project root:
   - `subgraph-schema.graphql` - Your subgraph's GraphQL schema
   - `hyperindex-schema.graphql` - Your HyperIndex GraphQL schema

3. **Run comparison**:
   ```bash
   pnpm compare
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
pnpm compare --deep-limit 1000 --entity Token

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
| `--subgraph-schema <path>` | Path to subgraph schema file |
| `--hyperindex-schema <path>` | Path to HyperIndex schema file |
| `--generate-config` | Generate entity config from schemas and exit |
| `--help, -h` | Show help |

## Configuration

### Environment Variables

Create a `.env` file with your endpoints:

```env
# GraphQL endpoints (required)
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/your-subgraph
HYPERINDEX_URL=https://your-indexer.hyperindex.xyz/v1/graphql

# Schema file paths (optional, defaults shown)
SUBGRAPH_SCHEMA=./subgraph-schema.graphql
HYPERINDEX_SCHEMA=./hyperindex-schema.graphql
OVERRIDES_PATH=./overrides.json
```

### Overrides File

Create an `overrides.json` file to handle field mappings and known issues:

```json
{
  "fieldMappings": {
    "EntityName": {
      "subgraphFieldName": "hyperindexFieldName"
    }
  },
  "knownIdMismatch": [
    "EntityWithDifferentIdFormat"
  ],
  "skipEntities": [
    "EntityToSkip"
  ]
}
```

See `overrides.template.json` for a blank template.

### Key Differences Handled

The tool automatically handles common differences between subgraph and HyperIndex:

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

## Examples

The `examples/` directory contains real-world migration examples:

- **examples/flaunch/** - Flaunch protocol migration with 66 entities

Each example includes:
- `subgraph-schema.graphql` - The original subgraph schema
- `hyperindex-schema.graphql` - The migrated HyperIndex schema
- `overrides.json` - Field mappings and known issues
- `README.md` - Migration-specific notes

## Known Limitations

- Maximum 100k records per entity in deep mode (safety limit)
- Nested object comparisons limited to ID extraction
- Array fields not fully supported yet

## Troubleshooting

### "No common IDs found"

Either:
- The entity has no data in one or both sources
- ID formats differ between systems (add to `knownIdMismatch` in overrides.json)

### Timeout errors

- Reduce sample size or use `--deep-limit`
- Check endpoint connectivity

### Field not found errors

- Verify field names match between schema and config
- Check for renamed fields and add to `fieldMappings` in overrides.json

## License

MIT
