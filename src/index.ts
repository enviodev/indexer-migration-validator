import { ENTITY_CONFIGS, DEFAULT_SAMPLE_SIZE, DEFAULT_BATCH_SIZE, type EntityName } from './config.js';
import * as subgraph from './clients/subgraph.js';
import * as hyperindex from './clients/hyperindex.js';
import { normalizeSubgraphResponse, normalizeHyperIndexResponse } from './comparators/normalize.js';
import { calculateDiff, type EntityDiff } from './comparators/diff.js';
import { printEntityDiff, printSummary } from './reporters/console.js';
import { generateReport, saveReport, getDefaultOutputPath } from './reporters/json.js';

interface CliArgs {
  entities: EntityName[];
  sampleSize: number;
  specificId?: string;
  outputPath: string;
  skipJson: boolean;
  deep: boolean;
  deepLimit?: number;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    entities: Object.keys(ENTITY_CONFIGS) as EntityName[],
    sampleSize: DEFAULT_SAMPLE_SIZE,
    outputPath: getDefaultOutputPath('./output'),
    skipJson: false,
    deep: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--entity' && args[i + 1]) {
      const entityName = args[i + 1] as EntityName;
      if (entityName in ENTITY_CONFIGS) {
        result.entities = [entityName];
      } else {
        console.error(`Unknown entity: ${entityName}`);
        console.error(`Available: ${Object.keys(ENTITY_CONFIGS).join(', ')}`);
        process.exit(1);
      }
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
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
Flaunch Subgraph vs HyperIndex Comparison Tool

Usage: pnpm compare [options]

Options:
  --entity <name>     Compare only specified entity (e.g., Pool, CollectionToken)
  --sample <n>        Number of random samples per entity (default: ${DEFAULT_SAMPLE_SIZE})
  --id <id>           Compare a specific ID across relevant entities
  --output <path>     Output JSON report path
  --no-json           Skip JSON report generation
  --deep              Deep comparison: fetch ALL records (uses pagination)
  --deep-limit <n>    Deep comparison with max N records per entity
  --help, -h          Show this help

Available entities:
  ${Object.keys(ENTITY_CONFIGS).join(', ')}

Examples:
  pnpm compare                          # Compare all entities (sample mode)
  pnpm compare --entity Pool            # Compare only Pool entity
  pnpm compare --sample 100             # Use larger sample size
  pnpm compare --deep --entity Pool     # Deep compare ALL Pool records
  pnpm compare --deep-limit 5000        # Deep compare up to 5000 records per entity
`);
}

/**
 * Get random sample of IDs from the intersection of both sources
 */
async function getRandomSampleIds(
  entityName: EntityName,
  sampleSize: number
): Promise<string[]> {
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

  // Random sample
  if (commonIds.length <= sampleSize) {
    return commonIds;
  }

  // Fisher-Yates shuffle and take first N
  const shuffled = [...commonIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, sampleSize);
}

/**
 * Compare a single entity type (sample mode)
 */
async function compareEntity(entityName: EntityName, sampleSize: number): Promise<EntityDiff> {
  console.log(`\nComparing ${entityName}...`);

  // Get random sample of IDs
  const sampleIds = await getRandomSampleIds(entityName, sampleSize);

  if (sampleIds.length === 0) {
    const config = ENTITY_CONFIGS[entityName] as any;
    if (config.knownIdMismatch) {
      console.log(`  No common IDs - known ID format mismatch (see PLANNED_FIXES.md)`);
    } else {
      console.log(`  No common IDs found for ${entityName}`);
    }
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

  console.log(`  Fetching ${sampleIds.length} records from both sources...`);

  // Fetch full data for sample IDs
  const [subgraphData, hyperindexData] = await Promise.all([
    subgraph.fetchByIds(entityName, sampleIds),
    hyperindex.fetchByIds(entityName, sampleIds)
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
async function deepCompareEntity(entityName: EntityName, limit?: number): Promise<EntityDiff> {
  console.log(`\n[DEEP] Comparing ${entityName}...`);

  const config = ENTITY_CONFIGS[entityName] as any;
  if (config.knownIdMismatch) {
    console.log(`  Skipping - known ID format mismatch (see PLANNED_FIXES.md)`);
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
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  console.log('===========================================');
  console.log('Flaunch Subgraph vs HyperIndex Comparison');
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
