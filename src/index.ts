import 'dotenv/config';
import { writeFileSync, createWriteStream } from 'fs';
import { basename, dirname, extname, join } from 'path';
import {
  DEFAULT_SAMPLE_SIZE,
  DEFAULT_BATCH_SIZE,
  getEntityConfigs,
  loadEntityConfigsFromSchemas,
  SUBGRAPH_SCHEMA_PATH,
  OVERRIDES_PATH,
  HYPERINDEX_SCHEMA_PATH,
  HYPERINDEX_URL,
} from './config.js';
import { setRuntimeOptions, USER_AGENT } from './runtime.js';
import * as subgraph from './clients/subgraph.js';
import * as hyperindex from './clients/hyperindex.js';
import { normalizeSubgraphResponse, normalizeHyperIndexResponse } from './comparators/normalize.js';
import { calculateDiff, type EntityDiff } from './comparators/diff.js';
import { printEntityDiff, printSummary } from './reporters/console.js';
import { generateReport, saveReport, getDefaultOutputPath } from './reporters/json.js';
import { parseSchemaFile } from './schema/parser.js';
import { generateConfigs, generateTypeScriptConfig, loadOverrides } from './schema/configGenerator.js';
import { getMatchSummary, matchSchemas } from './schema/matcher.js';

function getSummaryOutputPath(jsonOutputPath: string): string {
  const dir = dirname(jsonOutputPath);
  const base = basename(jsonOutputPath);
  const ext = extname(base);
  const baseNoExt = ext ? base.slice(0, -ext.length) : base;

  if (base.startsWith('comparison-')) {
    return join(dir, `summary-${baseNoExt}.md`);
  }

  return join(dir, `summary-${baseNoExt}.md`);
}

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
  /** Compare only this chain's slice of a multichain HyperIndex deployment. */
  chainId?: number;
  /** Pin the subgraph read to this block (The Graph time-travel). */
  endBlock?: number;
  /** Attempts per request before aborting the run. */
  retries?: number;
  /** Minimum ms between consecutive requests, to stay under rate limits. */
  throttleMs?: number;
  /** Entity-name prefix on a merged HyperIndex endpoint, e.g. `Helper_`. */
  entityPrefix?: string;
  /** Pin the HyperIndex read to this block (asymmetric partner to --end-block). */
  hyperindexMaxBlock?: number;
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
    } else if (arg === '--chain' && args[i + 1]) {
      result.chainId = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--end-block' && args[i + 1]) {
      result.endBlock = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--retries' && args[i + 1]) {
      result.retries = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--throttle-ms' && args[i + 1]) {
      result.throttleMs = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--entity-prefix' && args[i + 1]) {
      result.entityPrefix = args[i + 1];
      i++;
    } else if (arg === '--hyperindex-max-block' && args[i + 1]) {
      result.hyperindexMaxBlock = parseInt(args[i + 1], 10);
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

  // Publish run-scoped options before any client is used.
  setRuntimeOptions({
    chainId: result.chainId,
    endBlock: result.endBlock,
    entityPrefix: result.entityPrefix,
    hyperindexMaxBlock: result.hyperindexMaxBlock,
    ...(result.retries !== undefined ? { retries: result.retries } : {}),
    ...(result.throttleMs !== undefined ? { throttleMs: result.throttleMs } : {}),
  });

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

Multichain / fair-comparison options:
  --chain <id>              Compare only this chain's slice of a MULTICHAIN
                            HyperIndex deployment. Envio prefixes entity IDs
                            with '<chainId>-' when the indexer is multichain but
                            the subgraph was not. This filters HyperIndex to
                            'id _like "<id>-%"' and strips the prefix from 'id'
                            and every '*_id' foreign key before diffing.
                            Omit for single-chain indexers with bare IDs.
  --end-block <n>           Pin the SUBGRAPH read to this block via The Graph's
                            time-travel argument. Set it to the Envio side's
                            'latest_processed_block' (it trails head by ~200
                            blocks for reorg safety). WITHOUT THIS, every
                            mutable accumulator (Factory.txCount, DayData, ...)
                            drifts between the two heads and reports as a false
                            mismatch.
  --retries <n>             Attempts per request before aborting (default: 5).
                            Requests are retried with exponential backoff and
                            then THROW — a failed fetch is never reported as
                            "zero rows", which would look like missing entities.
  --entity-prefix <p>       Entity-name prefix on a MERGED HyperIndex endpoint
                            that serves several source subgraphs at once, e.g.
                            'Helper_' so subgraph 'Gauge' resolves to
                            'Helper_Gauge'. Applied to the schema lookup, the
                            GraphQL query field AND the response key.
  --hyperindex-max-block <n>
                            Pin the HYPERINDEX side to this block — the
                            asymmetric partner to --end-block, which pins only
                            the subgraph. Filters each entity on its own block
                            column. WITHOUT THIS, rows the indexer wrote after
                            the subgraph's pin report as pure 'extra' with '0
                            missing'. Entities with no block column (mutable
                            accumulators like Gauge/User/LiquidityPosition)
                            cannot be pinned and are only trustworthy against a
                            stopped or caught-up indexer — check it has not
                            moved at the END of the run.
  --throttle-ms <n>         Minimum ms between requests. Hosted HyperIndex
                            endpoints return 429 under sustained paging; pacing
                            avoids tripping the limit at all. 429/503 also get
                            their own larger retry budget with long backoff,
                            honouring Retry-After.

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

Multichain examples:
  # One chain of a multichain indexer vs its single-chain subgraph, both pinned
  # to the same height:
  pnpm compare --deep --chain 1776 --end-block 177318747

  # Single-chain indexer (bare IDs) — no --chain needed:
  pnpm compare --deep --end-block 23756547

See examples/ directory for sample configurations.
`);
}

/**
 * Per-chain `latest_processed_block` on the HyperIndex side.
 *
 * Sampled before and after every run. Entities with no block column cannot be
 * pinned (see --hyperindex-max-block), so their comparison is only valid if the
 * indexer did not advance while it was being read. Without this check a run
 * that drifted mid-flight is indistinguishable from a clean one, and the drift
 * shows up as field mismatches on exactly the mutable accumulators that are
 * hardest to reason about.
 */
async function readIndexerHead(): Promise<Record<number, number>> {
  const response = await fetch(HYPERINDEX_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      query: '{ chain_metadata { chain_id latest_processed_block } }',
    }),
  });
  const body = (await response.json()) as {
    data?: { chain_metadata?: Array<{ chain_id: number; latest_processed_block: number }> };
  };
  const heads: Record<number, number> = {};
  for (const row of body.data?.chain_metadata ?? []) {
    heads[row.chain_id] = row.latest_processed_block;
  }
  return heads;
}

function reportHeadDrift(
  before: Record<number, number>,
  after: Record<number, number>,
  chainId?: number,
): void {
  const chains = chainId === undefined
    ? Object.keys(before).map(Number)
    : [chainId];

  const moved = chains.filter(c => before[c] !== after[c]);
  if (moved.length === 0) {
    const shown = chains.map(c => `${c}@${before[c]}`).join(' ');
    console.log(`\n[head] indexer did not move during this run (${shown}).`);
    return;
  }

  console.warn(
    `\n[head] \x1b[31mINDEXER MOVED DURING THIS RUN\x1b[0m — unpinnable entities ` +
      `(those with no block column) may show spurious differences:`,
  );
  for (const c of moved) {
    console.warn(`  chain ${c}: ${before[c]} -> ${after[c]} (+${after[c] - before[c]})`);
  }
}

interface IdSampleResult {
  commonIds: string[];
  subgraphIds: string[];
  hyperindexIds: string[];
  suspectedIdMismatch: boolean;
}

/**
 * Convert Bytes ID to hex string if it's binary data for display
 */
function formatIdForDisplay(id: string): string {
  // Already hex string
  if (typeof id === 'string' && id.startsWith('0x')) {
    return id;
  }
  // Check if it looks like binary data (non-printable chars)
  if (typeof id === 'string' && /[\x00-\x08\x0E-\x1F\x7F-\xFF]/.test(id)) {
    // Convert binary string to hex
    let hex = '0x';
    for (let i = 0; i < id.length; i++) {
      const charCode = id.charCodeAt(i);
      hex += charCode.toString(16).padStart(2, '0');
    }
    return hex;
  }
  return id;
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
      idResult.subgraphIds.slice(0, 3).forEach(id => {
        const displayId = formatIdForDisplay(id);
        console.log(`    - ${displayId}`);
      });
      console.log(`  Sample HyperIndex IDs:`);
      idResult.hyperindexIds.slice(0, 3).forEach(id => {
        const displayId = formatIdForDisplay(id);
        console.log(`    - ${displayId}`);
      });
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

  // Apply limit if specified, or default cap for deep mode
  let idsToCompare = commonIds;
  // NO implicit cap. This used to default to 10000, which silently truncated
  // every entity larger than that and reported the run as complete — a
  // "deep, no caps" comparison that quietly skipped 140k of 171k Transactions.
  // A cap now only exists if the caller passed --deep-limit explicitly.
  const effectiveLimit = limit;
  let comparisonTruncated = false;
  if (effectiveLimit && commonIds.length > effectiveLimit) {
    console.log(`  Limiting to ${effectiveLimit} records (of ${commonIds.length} common)`);
    idsToCompare = commonIds.slice(0, effectiveLimit);
    comparisonTruncated = true;
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
  diff.comparisonTruncated = comparisonTruncated;

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

  // Load overrides if available.
  // Must honour OVERRIDES_PATH: hardcoding './overrides.json' made
  // --generate-config read a different file from the one `compare` actually
  // uses, so the preview it printed did not reflect the real run.
  console.log(`Overrides: ${OVERRIDES_PATH}`);
  const overrides = loadOverrides(OVERRIDES_PATH);

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

  // Tee all output to a summary file next to the JSON report path.
  // This captures the exact console output (including progress logs) in a file.
  const summaryPath = getSummaryOutputPath(args.outputPath);
  const summaryStream = createWriteStream(summaryPath, { encoding: 'utf-8' });
  summaryStream.write(`# Comparison summary output\n\n`);
  summaryStream.write(`This file captures the terminal output from this run.\n\n`);
  summaryStream.write('```text\n');
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const ansiRegex = /\x1b\[[0-9;]*m/g;
  let pendingLine = '';

  function shouldKeepSummaryLine(line: string): boolean {
    const t = line.trim();
    if (t === '') return true;

    // Keep the actual comparison outputs and structured sections.
    if (t.startsWith('=== ') || t.startsWith('========== ')) return true;
    if (t === 'Entity Status:' || t === 'Totals:') return true;
    if (t.startsWith('Field mismatch')) return true;
    if (t.startsWith('Records:') || t.startsWith('Compared:')) return true;
    if (t.startsWith('Missing in HyperIndex:') || t.startsWith('Missing in Subgraph:')) return true;
    if (t.startsWith('Status:')) return true;
    if (t.startsWith('Overall:')) return true;
    if (/^\[(OK|WARN|ERR)\]\s+/.test(t)) return true; // entity status list items

    // Keep mismatch details (IDs and field/value lines)
    if (/^0x[0-9a-fA-F]{6,}/.test(t)) return true;
    if (/^\d/.test(t) && t.includes(':')) return true; // e.g. 100#101574139:
    if (/^e\.g\.\s+/.test(t)) return true;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*:\s+/.test(t)) return true; // field: "a" vs "b"

    // Drop operational/logging/progress lines.
    const noisyPrefixes = [
      'Loaded overrides from:',
      'Parsing subgraph schema:',
      'Parsing hyperindex schema:',
      'Subgraph:',
      'HyperIndex:',
      'Generated ',
      'Warnings:',
      'Loaded ',
      'Subgraph vs HyperIndex Comparison',
      'Entities:',
      'Mode:',
      '[DEEP] Comparing',
      '[DEEP]',
      'Comparing ',
      'Fetching ',
      'etching ',
      'Received:',
      'Subgraph has ',
      'HyperIndex has ',
      'Common IDs:',
      'Common:',
      'Limiting to ',
      'Report saved to:',
      'Summary output saved to:',
    ];
    for (const p of noisyPrefixes) {
      if (t.startsWith(p)) return false;
    }

    // Default: keep (better to be conservative about dropping important lines).
    return true;
  }

  function writeToSummaryFile(chunk: unknown): void {
    const raw = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
    const text = raw.replace(ansiRegex, '');

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === '\r') {
        // Progress update: overwrite current line (don’t emit anything yet)
        pendingLine = '';
        continue;
      }

      if (ch === '\n') {
        // Only write completed lines. This collapses progress spam into a single final line.
        if (shouldKeepSummaryLine(pendingLine)) {
          summaryStream.write(pendingLine + '\n');
        }
        pendingLine = '';
        continue;
      }

      pendingLine += ch;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown, ...rest: unknown[]) => {
    writeToSummaryFile(chunk);
    // @ts-expect-error passthrough to node stdout
    return originalStdoutWrite(chunk, ...(rest as any));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown, ...rest: unknown[]) => {
    writeToSummaryFile(chunk);
    // @ts-expect-error passthrough to node stderr
    return originalStderrWrite(chunk, ...(rest as any));
  };

  const diffs: EntityDiff[] = [];
  const headBefore = await readIndexerHead();
  console.log(
    `Indexer head at start: ${Object.entries(headBefore)
      .map(([c, b]) => `${c}@${b}`)
      .join(' ')}`,
  );

  try {
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

    reportHeadDrift(headBefore, await readIndexerHead(), args.chainId);

    // Generate JSON report
    if (!args.skipJson) {
      const report = generateReport(diffs);
      saveReport(report, args.outputPath);
    }

    console.log(`\nSummary output saved to: ${summaryPath}`);
  } finally {
    // Restore streams even if the compare fails midway
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = originalStdoutWrite;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = originalStderrWrite;
    if (pendingLine.length > 0) {
      summaryStream.write(pendingLine + '\n');
      pendingLine = '';
    }
    summaryStream.write('\n```\n');
    summaryStream.end();
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
