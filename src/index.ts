import { writeFileSync } from 'fs';
import {
  DEFAULT_SAMPLE_SIZE,
  DEFAULT_BATCH_SIZE,
  getEntityConfigs,
  loadEntityConfigsFromSchemas,
  SUBGRAPH_SCHEMA_PATH,
  HYPERINDEX_SCHEMA_PATH,
} from './config.js';
import * as subgraph from './clients/subgraph.js';
import * as hyperindex from './clients/hyperindex.js';
import { normalizeSubgraphResponse, normalizeHyperIndexResponse } from './comparators/normalize.js';
import { calculateDiff, type EntityDiff } from './comparators/diff.js';
import { printEntityDiff, printSummary } from './reporters/console.js';
import { generateReport, saveReport, getDefaultOutputPath } from './reporters/json.js';
import { parseSchemaFile } from './schema/parser.js';
import { generateConfigs, generateTypeScriptConfig, loadOverrides } from './schema/configGenerator.js';
import { getMatchSummary, matchSchemas } from './schema/matcher.js';

interface CliArgs {
  entities: string[];
  sampleSize: number;
  specificId?: string;
  outputPath: string;
  skipJson: boolean;
  deep: boolean;
  deepLimit?: number;
  // Schema-driven options
  subgraphSchema?: string;
  hyperindexSchema?: string;
  generateConfigOnly: boolean;
  configOutput?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    entities: [], // Will be set after config loading
    sampleSize: DEFAULT_SAMPLE_SIZE,
    outputPath: getDefaultOutputPath('./output'),
    skipJson: false,
    deep: false,
    generateConfigOnly: false
  };

  let specifiedEntity: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--entity' && args[i + 1]) {
      specifiedEntity = args[i + 1];
      i++;
    } else if (arg === '--sample' && args[i + 1]) {
      result.sampleSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--id' && args[i + 1]) {
      result.specificId = args[i + 1];
      i++;
    } else if (arg === '--output' && args[i + 1]) {
      result.outputPath = args[i + 1];
      i++;
    } else if (arg === '--no-json') {
      result.skipJson = true;
    } else if (arg === '--deep') {
      result.deep = true;
    } else if (arg === '--deep-limit' && args[i + 1]) {
      result.deep = true;
      result.deepLimit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--subgraph-schema' && args[i + 1]) {
      result.subgraphSchema = args[i + 1];
      i++;
    } else if (arg === '--hyperindex-schema' && args[i + 1]) {
      result.hyperindexSchema = args[i + 1];
      i++;
    } else if (arg === '--generate-config') {
      result.generateConfigOnly = true;
    } else if (arg === '--config-output' && args[i + 1]) {
      result.configOutput = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Store specified entity to validate after config loading
  if (specifiedEntity) {
    result.entities = [specifiedEntity];
  }

  return result;
}

function printHelp(): void {
  console.log(`
Indexer Migration Validator - Subgraph vs HyperIndex Comparison Tool

Usage: pnpm compare [options]

Options:
  --entity <name>           Compare only specified entity (e.g., Pool, Token)
  --sample <n>              Number of random samples per entity (default: ${DEFAULT_SAMPLE_SIZE})
  --id <id>                 Compare a specific ID across relevant entities
  --output <path>           Output JSON report path
  --no-json                 Skip JSON report generation
  --deep                    Deep comparison: fetch ALL records (uses pagination)
  --deep-limit <n>          Deep comparison with max N records per entity
  --help, -h                Show this help

Schema options:
  --subgraph-schema <path>  Path to subgraph schema file (default: ./subgraph-schema.graphql)
  --hyperindex-schema <path> Path to hyperindex schema file (default: ./hyperindex-schema.graphql)
  --generate-config         Generate entity config from schemas and exit
  --config-output <path>    Output path for generated config (default: ./generated-entity-configs.ts)

Environment variables:
  SUBGRAPH_URL              Subgraph GraphQL endpoint (required)
  HYPERINDEX_URL            HyperIndex GraphQL endpoint (required)
  SUBGRAPH_SCHEMA           Path to subgraph schema file
  HYPERINDEX_SCHEMA         Path to hyperindex schema file
  OVERRIDES_PATH            Path to overrides.json file

Examples:
  pnpm compare                          # Compare all entities
  pnpm compare --entity Pool            # Compare only Pool entity
  pnpm compare --sample 100             # Use larger sample size
  pnpm compare --deep --entity Pool     # Deep compare ALL Pool records
  pnpm compare --deep-limit 5000        # Deep compare up to 5000 records per entity
  pnpm compare --generate-config        # Generate config from schema files

See examples/ directory for sample configurations.
`);
}

interface IdSampleResult {
  commonIds: string[];
  subgraphIds: string[];
  hyperindexIds: string[];
  suspectedIdMismatch: boolean;
}

/**
 * Get random sample of IDs from the intersection of both sources
 */
async function getRandomSampleIds(
  entityName: string,
  sampleSize: number
): Promise<IdSampleResult> {
  console.log(`  Fetching IDs from both sources...`);

  // Fetch IDs from both sources
  const [subgraphIds, hyperindexIds] = await Promise.all([
    subgraph.fetchIds(entityName, DEFAULT_BATCH_SIZE),
    hyperindex.fetchIds(entityName, DEFAULT_BATCH_SIZE)
  ]);

  console.log(`  Subgraph has ${subgraphIds.length} IDs, HyperIndex has ${hyperindexIds.length} IDs`);

  // Find intersection
  const hyperindexIdSet = new Set(hyperindexIds);
  const commonIds = subgraphIds.filter(id => hyperindexIdSet.has(id));

  console.log(`  Common IDs: ${commonIds.length}`);

  // Detect suspected ID format mismatch: both have records but no overlap
  const suspectedIdMismatch = subgraphIds.length > 0 && hyperindexIds.length > 0 && commonIds.length === 0;

  // Random sample
  let sampledCommonIds = commonIds;
  if (commonIds.length > sampleSize) {
    // Fisher-Yates shuffle and take first N
    const shuffled = [...commonIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    sampledCommonIds = shuffled.slice(0, sampleSize);
  }

  return {
    commonIds: sampledCommonIds,
    subgraphIds,
    hyperindexIds,
    suspectedIdMismatch
  };
}

/**
 * Compare a single entity type (sample mode)
 */
async function compareEntity(entityName: string, sampleSize: number): Promise<EntityDiff> {
  console.log(`\nComparing ${entityName}...`);

  // Get random sample of IDs
  const idResult = await getRandomSampleIds(entityName, sampleSize);
  const entityConfigs = getEntityConfigs();
  const config = entityConfigs[entityName];

  if (idResult.commonIds.length === 0) {
    // Check if this is a suspected ID mismatch
    if (idResult.suspectedIdMismatch) {
      console.log(`  \x1b[31m⚠ SUSPECTED ID FORMAT MISMATCH!\x1b[0m`);
      console.log(`  Both sources have records but NO common IDs found.`);
      console.log(`  Sample Subgraph IDs:`);
      idResult.subgraphIds.slice(0, 3).forEach(id => console.log(`    - ${id}`));
      console.log(`  Sample HyperIndex IDs:`);
      idResult.hyperindexIds.slice(0, 3).forEach(id => console.log(`    - ${id}`));
    } else if (config?.knownIdMismatch) {
      console.log(`  No common IDs - known ID format mismatch`);
    } else {
      console.log(`  No common IDs found for ${entityName}`);
    }

    return {
      entityName,
      subgraphCount: idResult.subgraphIds.length,
      hyperindexCount: idResult.hyperindexIds.length,
      commonIds: [],
      missingInHyperindex: idResult.subgraphIds,
      missingInSubgraph: idResult.hyperindexIds,
      fieldMismatches: [],
      matchedCount: 0,
      mismatchedCount: 0,
      suspectedIdMismatch: idResult.suspectedIdMismatch,
      sampleSubgraphIds: idResult.subgraphIds.slice(0, 5),
      sampleHyperindexIds: idResult.hyperindexIds.slice(0, 5)
    };
  }

  console.log(`  Fetching ${idResult.commonIds.length} records from both sources...`);

  // Fetch full data for sample IDs
  const [subgraphData, hyperindexData] = await Promise.all([
    subgraph.fetchByIds(entityName, idResult.commonIds),
    hyperindex.fetchByIds(entityName, idResult.commonIds)
  ]);

  console.log(`  Received: Subgraph=${subgraphData.length}, HyperIndex=${hyperindexData.length}`);

  // Normalize responses
  const normalizedSubgraph = normalizeSubgraphResponse(entityName, subgraphData);
  const normalizedHyperindex = normalizeHyperIndexResponse(entityName, hyperindexData);

  // Calculate diff
  return calculateDiff(entityName, normalizedSubgraph, normalizedHyperindex);
}

/**
 * Deep compare a single entity type (fetch ALL records)
 */
async function deepCompareEntity(entityName: string, limit?: number): Promise<EntityDiff> {
  console.log(`\n[DEEP] Comparing ${entityName}...`);

  const entityConfigs = getEntityConfigs();
  const config = entityConfigs[entityName];
  if (config?.knownIdMismatch) {
    console.log(`  Skipping - known ID format mismatch (configure in overrides.json)`);
    return {
      entityName,
      subgraphCount: 0,
      hyperindexCount: 0,
      commonIds: [],
      missingInHyperindex: [],
      missingInSubgraph: [],
      fieldMismatches: [],
      matchedCount: 0,
      mismatchedCount: 0
    };
  }

  // Fetch ALL IDs from both sources with progress
  process.stdout.write(`  Fetching all IDs from Subgraph...`);
  const subgraphIds = await subgraph.fetchAllIds(entityName, (count) => {
    process.stdout.write(`\r  Fetching all IDs from Subgraph... ${count}`);
  });
  console.log(` Done (${subgraphIds.length})`);

  process.stdout.write(`  Fetching all IDs from HyperIndex...`);
  const hyperindexIds = await hyperindex.fetchAllIds(entityName, (count) => {
    process.stdout.write(`\r  Fetching all IDs from HyperIndex... ${count}`);
  });
  console.log(` Done (${hyperindexIds.length})`);

  // Find common IDs and missing IDs
  const subgraphIdSet = new Set(subgraphIds);
  const hyperindexIdSet = new Set(hyperindexIds);

  const commonIds = subgraphIds.filter(id => hyperindexIdSet.has(id));
  const missingInHyperindex = subgraphIds.filter(id => !hyperindexIdSet.has(id));
  const missingInSubgraph = hyperindexIds.filter(id => !subgraphIdSet.has(id));

  console.log(`  Common: ${commonIds.length}, Missing in HyperIndex: ${missingInHyperindex.length}, Missing in Subgraph: ${missingInSubgraph.length}`);

  if (commonIds.length === 0) {
    return {
      entityName,
      subgraphCount: subgraphIds.length,
      hyperindexCount: hyperindexIds.length,
      commonIds: [],
      missingInHyperindex,
      missingInSubgraph,
      fieldMismatches: [],
      matchedCount: 0,
      mismatchedCount: 0
    };
  }

  // Apply limit if specified
  let idsToCompare = commonIds;
  if (limit && commonIds.length > limit) {
    console.log(`  Limiting to ${limit} records (of ${commonIds.length} common)`);
    idsToCompare = commonIds.slice(0, limit);
  }

  // Fetch full data for all common IDs with progress
  process.stdout.write(`  Fetching ${idsToCompare.length} records from Subgraph...`);
  const subgraphData = await subgraph.fetchAllByIds(entityName, idsToCompare, (fetched, total) => {
    process.stdout.write(`\r  Fetching ${idsToCompare.length} records from Subgraph... ${fetched}/${total}`);
  });
  console.log(` Done`);

  process.stdout.write(`  Fetching ${idsToCompare.length} records from HyperIndex...`);
  const hyperindexData = await hyperindex.fetchAllByIds(entityName, idsToCompare, (fetched, total) => {
    process.stdout.write(`\r  Fetching ${idsToCompare.length} records from HyperIndex... ${fetched}/${total}`);
  });
  console.log(` Done`);

  // Normalize responses
  const normalizedSubgraph = normalizeSubgraphResponse(entityName, subgraphData);
  const normalizedHyperindex = normalizeHyperIndexResponse(entityName, hyperindexData);

  // Calculate diff
  const diff = calculateDiff(entityName, normalizedSubgraph, normalizedHyperindex);

  // Add the missing IDs info to the diff
  diff.subgraphCount = subgraphIds.length;
  diff.hyperindexCount = hyperindexIds.length;
  diff.missingInHyperindex = missingInHyperindex;
  diff.missingInSubgraph = missingInSubgraph;

  return diff;
}

/**
 * Generate config from schema files and exit
 */
async function generateConfigCommand(args: CliArgs): Promise<void> {
  console.log('Generating entity config from schema files...\n');

  const sgPath = args.subgraphSchema || SUBGRAPH_SCHEMA_PATH;
  const hiPath = args.hyperindexSchema || HYPERINDEX_SCHEMA_PATH;

  console.log(`Subgraph schema: ${sgPath}`);
  console.log(`HyperIndex schema: ${hiPath}`);

  const subgraphSchema = parseSchemaFile(sgPath);
  const hyperindexSchema = parseSchemaFile(hiPath);

  console.log(`\nSubgraph: ${subgraphSchema.entities.size} entities, ${subgraphSchema.enums.size} enums`);
  console.log(`HyperIndex: ${hyperindexSchema.entities.size} entities`);

  // Load overrides if available
  const overrides = loadOverrides('./overrides.json');

  const result = generateConfigs(subgraphSchema, hyperindexSchema, overrides);

  console.log(`\nMatched ${Object.keys(result.configs).length} entities`);

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

  // Output generated config as TypeScript
  const outputPath = args.configOutput || './generated-entity-configs.ts';
  const configCode = generateTypeScriptConfig(result.configs);
  writeFileSync(outputPath, configCode);
  console.log(`\nGenerated config written to: ${outputPath}`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  // Handle generate-config mode
  if (args.generateConfigOnly) {
    await generateConfigCommand(args);
    return;
  }

  // Load entity configs from schema files
  let entityConfigs: Record<string, any>;

  try {
    entityConfigs = await loadEntityConfigsFromSchemas(
      args.subgraphSchema,
      args.hyperindexSchema,
      undefined,
      true // verbose
    );
    console.log(`\nLoaded ${Object.keys(entityConfigs).length} entity configs from schemas`);
  } catch (error) {
    console.error('\nError: Could not load schema files.');
    console.error('Please provide schema files using:');
    console.error('  --subgraph-schema <path>   Path to subgraph GraphQL schema');
    console.error('  --hyperindex-schema <path> Path to HyperIndex GraphQL schema');
    console.error('\nOr set environment variables:');
    console.error('  SUBGRAPH_SCHEMA=./path/to/subgraph-schema.graphql');
    console.error('  HYPERINDEX_SCHEMA=./path/to/hyperindex-schema.graphql');
    console.error('\nSee examples/ directory for sample configurations.');
    process.exit(1);
  }

  // Validate and set entities to compare
  if (args.entities.length === 0) {
    args.entities = Object.keys(entityConfigs);
  } else {
    // Validate specified entity exists
    const entityName = args.entities[0];
    if (!(entityName in entityConfigs)) {
      console.error(`Unknown entity: ${entityName}`);
      console.error(`Available: ${Object.keys(entityConfigs).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('\n===========================================');
  console.log('Subgraph vs HyperIndex Comparison');
  console.log('===========================================');
  console.log(`Entities: ${args.entities.length}`);
  if (args.deep) {
    console.log(`Mode: DEEP (full comparison${args.deepLimit ? `, limit ${args.deepLimit}` : ''})`);
  } else {
    console.log(`Mode: Sample (${args.sampleSize} per entity)`);
  }

  const diffs: EntityDiff[] = [];

  for (const entityName of args.entities) {
    try {
      const diff = args.deep
        ? await deepCompareEntity(entityName, args.deepLimit)
        : await compareEntity(entityName, args.sampleSize);
      diffs.push(diff);
      printEntityDiff(diff);
    } catch (error) {
      console.error(`\nError comparing ${entityName}:`, error);
    }
  }

  // Print summary
  printSummary(diffs);

  // Generate JSON report
  if (!args.skipJson) {
    const report = generateReport(diffs);
    saveReport(report, args.outputPath);
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
