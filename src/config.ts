import { existsSync } from 'fs';
import { parseSchemaFile } from './schema/parser.js';
import { generateConfigs, loadOverrides } from './schema/configGenerator.js';
import { getMatchSummary } from './schema/matcher.js';
import type { GeneratedEntityConfig, Overrides } from './schema/types.js';

// Endpoint configuration (from environment - required)
export const SUBGRAPH_URL = process.env.SUBGRAPH_URL || '';
export const HYPERINDEX_URL = process.env.HYPERINDEX_URL || '';

// Schema file paths (from environment or defaults)
export const SUBGRAPH_SCHEMA_PATH = process.env.SUBGRAPH_SCHEMA || './subgraph-schema.graphql';
export const HYPERINDEX_SCHEMA_PATH = process.env.HYPERINDEX_SCHEMA || './hyperindex-schema.graphql';
export const OVERRIDES_PATH = process.env.OVERRIDES_PATH || './overrides.json';

// Comparison settings
export const DEFAULT_SAMPLE_SIZE = 50;
export const DEFAULT_BATCH_SIZE = 500;

// Numeric field threshold for flagging discrepancies (percentage)
export const DISCREPANCY_THRESHOLD_PERCENT = 1;

// Dynamic config state
let _entityConfigs: Record<string, GeneratedEntityConfig> | null = null;
let _configSource: 'schema' | 'legacy' = 'legacy';

/**
 * Load entity configs from schema files
 */
export async function loadEntityConfigsFromSchemas(
  subgraphSchemaPath?: string,
  hyperindexSchemaPath?: string,
  overridesPath?: string,
  verbose: boolean = false
): Promise<Record<string, GeneratedEntityConfig>> {
  const sgPath = subgraphSchemaPath || SUBGRAPH_SCHEMA_PATH;
  const hiPath = hyperindexSchemaPath || HYPERINDEX_SCHEMA_PATH;
  const ovPath = overridesPath || OVERRIDES_PATH;

  if (!existsSync(sgPath)) {
    throw new Error(`Subgraph schema file not found: ${sgPath}`);
  }
  if (!existsSync(hiPath)) {
    throw new Error(`HyperIndex schema file not found: ${hiPath}`);
  }

  // Load overrides if available
  let overrides: Overrides = {};
  if (existsSync(ovPath)) {
    overrides = loadOverrides(ovPath);
    if (verbose) {
      console.log(`Loaded overrides from: ${ovPath}`);
    }
  }

  // Parse schemas
  if (verbose) {
    console.log(`Parsing subgraph schema: ${sgPath}`);
  }
  const subgraphSchema = parseSchemaFile(sgPath);

  if (verbose) {
    console.log(`Parsing hyperindex schema: ${hiPath}`);
  }
  const hyperindexSchema = parseSchemaFile(hiPath);

  if (verbose) {
    console.log(`Subgraph: ${subgraphSchema.entities.size} entities, ${subgraphSchema.enums.size} enums`);
    console.log(`HyperIndex: ${hyperindexSchema.entities.size} entities`);
  }

  // Generate configs
  const result = generateConfigs(subgraphSchema, hyperindexSchema, overrides);

  if (verbose) {
    console.log(`\nGenerated ${Object.keys(result.configs).length} entity configs`);

    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      result.warnings.forEach(w => console.log(`  [${w.type}] ${w.entityName}: ${w.message}`));
    }

    if (result.unmatchedSubgraphEntities.length > 0) {
      console.log(`\nUnmatched Subgraph Entities: ${result.unmatchedSubgraphEntities.join(', ')}`);
    }

    if (result.unmatchedHyperindexEntities.length > 0) {
      console.log(`\nUnmatched HyperIndex Entities: ${result.unmatchedHyperindexEntities.join(', ')}`);
    }

    // These fields are NEVER COMPARED. Printing them is the difference between
    // "this entity matched" and "this entity matched on the fields we looked at".
    const unmappedEntries = Object.entries(result.unmappedSubgraphFields);
    if (unmappedEntries.length > 0) {
      console.log(`\nUNCOMPARED subgraph fields (no hyperindex counterpart):`);
      for (const [entity, fields] of unmappedEntries) {
        console.log(`  ${entity}: ${fields.join(', ')}`);
      }
    }
  }

  _entityConfigs = result.configs;
  _configSource = 'schema';

  return result.configs;
}

/**
 * Get entity configs (must be loaded first via loadEntityConfigsFromSchemas)
 */
export function getEntityConfigs(): Record<string, GeneratedEntityConfig> {
  if (_entityConfigs) {
    return _entityConfigs;
  }
  throw new Error(
    'No entity configs loaded. Please provide schema files using --subgraph-schema and --hyperindex-schema options, ' +
    'or set SUBGRAPH_SCHEMA and HYPERINDEX_SCHEMA environment variables.'
  );
}

/**
 * Set entity configs programmatically
 */
export function setEntityConfigs(configs: Record<string, GeneratedEntityConfig>): void {
  _entityConfigs = configs;
  _configSource = 'schema';
}

/**
 * Get the source of current configs
 */
export function getConfigSource(): 'schema' | 'legacy' {
  return _configSource;
}
