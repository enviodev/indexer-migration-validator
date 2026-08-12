// Config Generator - generates EntityConfig from matched schemas
import {
  ParsedSchema,
  ParsedEntity,
  EntityMatch,
  GeneratedEntityConfig,
  ConfigWarning,
  GeneratorResult,
  Overrides,
} from './types.js';
import { matchSchemas } from './matcher.js';
import { readFileSync, existsSync } from 'fs';

/**
 * Generate entity configs from subgraph and hyperindex schemas
 */
export function generateConfigs(
  subgraphSchema: ParsedSchema,
  hyperindexSchema: ParsedSchema,
  overrides?: Overrides
): GeneratorResult {
  const matchResult = matchSchemas(subgraphSchema, hyperindexSchema, overrides);
  const configs: Record<string, GeneratedEntityConfig> = {};
  const warnings: ConfigWarning[] = [];
  const unmappedSubgraphFields: Record<string, string[]> = {};

  const knownIdMismatchSet = new Set(overrides?.knownIdMismatch || []);
  const idMatchConfirmedSet = new Set(overrides?.idMatchConfirmed || []);

  for (const match of matchResult.matches) {
    const config = generateEntityConfig(match, knownIdMismatchSet, idMatchConfirmedSet);
    configs[match.subgraphEntity.name] = config;

    if (match.unmappedSubgraphFields.length > 0) {
      unmappedSubgraphFields[match.subgraphEntity.name] = match.unmappedSubgraphFields;
    }

    // Generate warnings
    if (match.confidence < 0.8) {
      warnings.push({
        entityName: match.subgraphEntity.name,
        type: 'low_confidence',
        message: `Only ${(match.confidence * 100).toFixed(0)}% of fields matched (${match.unmappedSubgraphFields.length} unmapped)`
      });
    }

    // Warn about renamed fields
    const renamedMappings = match.fieldMappings.filter(m => m.mappingType === 'renamed');
    for (const mapping of renamedMappings) {
      warnings.push({
        entityName: match.subgraphEntity.name,
        type: 'field_rename',
        message: `Field renamed: ${mapping.subgraphField} -> ${mapping.hyperindexField}`
      });
    }

    // Check for ID type differences
    const sgIdField = match.subgraphEntity.fields.find(f => f.name === 'id');
    const hiIdField = match.hyperindexEntity.fields.find(f => f.name === 'id');
    if (sgIdField && hiIdField) {
      const sgIdType = sgIdField.baseType;
      const hiIdType = hiIdField.baseType;
      // Bytes -> String is expected, only warn for unexpected differences
      if (sgIdType !== 'Bytes' && sgIdType !== 'ID' && hiIdType !== 'String') {
        warnings.push({
          entityName: match.subgraphEntity.name,
          type: 'id_type_diff',
          message: `Unexpected ID type: ${sgIdType} -> ${hiIdType}`
        });
      }
    }
  }

  return {
    configs,
    warnings,
    unmatchedSubgraphEntities: matchResult.unmatchedSubgraph,
    unmatchedHyperindexEntities: matchResult.unmatchedHyperindex,
    unmappedSubgraphFields
  };
}

/**
 * Generate a single entity config from an EntityMatch
 */
function generateEntityConfig(
  match: EntityMatch,
  knownIdMismatch: Set<string>,
  idMatchConfirmed: Set<string> = new Set()
): GeneratedEntityConfig {
  const { subgraphEntity, fieldMappings } = match;

  // Generate query names.
  //
  // The hyperindex name comes from the MATCHED entity, not from the subgraph
  // name, because on a merged endpoint they differ (`Gauge` -> `Helper_Gauge`).
  // Deriving it from the subgraph name instead would silently query a field
  // that does not exist.
  const subgraphName = toSubgraphQueryName(subgraphEntity.name);
  const hyperindexName = match.hyperindexEntity.name;

  // Separate direct fields from nested fields and renamed fields
  const fields: string[] = [];
  const nestedFields: Record<string, string> = {};
  const fieldMapping: Record<string, string> = {};

  for (const mapping of fieldMappings) {
    switch (mapping.mappingType) {
      case 'direct':
        fields.push(mapping.subgraphField);
        break;
      case 'nested_to_flat':
        nestedFields[mapping.subgraphField] = mapping.hyperindexField;
        break;
      case 'renamed':
        // For renamed fields, store the mapping and use subgraph field name in fields
        // The subgraph client will use subgraph field names
        // The hyperindex client will translate using fieldMapping
        fieldMapping[mapping.subgraphField] = mapping.hyperindexField;
        fields.push(mapping.subgraphField);
        break;
      case 'type_converted':
        fields.push(mapping.subgraphField);
        break;
    }
  }

  // Detect if ID formats likely differ
  // An explicit `idMatchConfirmed` entry clears the name-based heuristic, which
  // otherwise flags entities like `Swap` and causes --deep to skip them
  // silently. An explicit `knownIdMismatch` entry always wins.
  const hasKnownIdMismatch = knownIdMismatch.has(subgraphEntity.name) ||
    (!idMatchConfirmed.has(subgraphEntity.name) && detectIdMismatch(subgraphEntity.name));

  const blockField = detectBlockField(match.hyperindexEntity);

  return {
    subgraphName,
    hyperindexName,
    fields,
    nestedFields,
    fieldMapping,
    knownIdMismatch: hasKnownIdMismatch,
    ...(blockField ? { blockField } : {})
  };
}

/**
 * The column to pin the HyperIndex side on, if the entity has one.
 *
 * Order matters. `blockNumber` is the block the row was WRITTEN at, so it pins
 * exactly. `createdAtBlockNumber` only pins the row's EXISTENCE — a row created
 * before the pin keeps mutating afterwards — but that is still enough to stop
 * post-pin rows appearing as spurious `extra`, which is what this filter is
 * for. Entities with neither are mutable accumulators and cannot be pinned at
 * all; they are only trustworthy against a stopped or caught-up indexer.
 */
function detectBlockField(hiEntity: ParsedEntity): string | undefined {
  const candidates = ['blockNumber', 'block', 'createdAtBlockNumber', 'createdAtBlock'];
  const byName = new Map(hiEntity.fields.map(f => [f.name, f]));
  for (const candidate of candidates) {
    const field = byName.get(candidate);
    // Must be a scalar number we can compare against; a relation named `block`
    // would produce `{_lte: N}` against an object column and fail the query.
    if (field && !field.isRelation && !field.isArray) return candidate;
  }
  return undefined;
}

/**
 * Convert entity name to subgraph query name (plural camelCase)
 */
function toSubgraphQueryName(entityName: string): string {
  // Handle special cases based on actual subgraph conventions
  const specialCases: Record<string, string> = {
    'NFTLookup': 'nftlookups',
    'PoolFees': 'poolFees_collection', // Uses _collection suffix for list query
    'Activity': 'activities',
    'TokenDayData': 'tokenDayDatas',
    'TokenHourData': 'tokenHourDatas',
    'TokenMinuteData': 'tokenMinuteDatas',
    'Token15MinuteData': 'token15MinuteDatas',
    'Token4HourData': 'token4HourDatas',
    'CollectionMetadata': 'collectionMetadata_collection', // Immutable entity uses _collection suffix
    'MemecoinTreasury': 'memecoinTreasuries',
    'User': 'users', // Explicit plural for User entity
  };

  if (specialCases[entityName]) {
    return specialCases[entityName];
  }

  // Standard: PascalCase -> camelCase -> pluralize
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  return pluralize(camelCase);
}

/**
 * Simple English pluralization rules
 */
function pluralize(word: string): string {
  // Words ending in 's', 'x', 'z', 'ch', 'sh' add 'es'
  if (/[sxz]$/.test(word) || /[cs]h$/.test(word)) {
    return word + 'es';
  }

  // Words ending in consonant + 'y' change 'y' to 'ies'
  if (/[^aeiou]y$/.test(word)) {
    return word.slice(0, -1) + 'ies';
  }

  // Default: add 's'
  return word + 's';
}

/**
 * Detect entities with likely ID format mismatches
 */
function detectIdMismatch(entityName: string): boolean {
  // Entities with composite IDs or timestamp-based IDs often have mismatches
  const problematicPatterns = [
    'Swap', 'Activity', 'HoldingChange', 'Delta', 'Claimed'
  ];
  return problematicPatterns.some(p => entityName.includes(p));
}

/**
 * Generate TypeScript code for the entity configs
 */
export function generateTypeScriptConfig(configs: Record<string, GeneratedEntityConfig>): string {
  const lines: string[] = [];

  lines.push('// Auto-generated entity configs from schema files');
  lines.push(`// Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('export const ENTITY_CONFIGS = {');

  const entries = Object.entries(configs);
  for (let i = 0; i < entries.length; i++) {
    const [name, config] = entries[i];
    const comma = i < entries.length - 1 ? ',' : '';

    lines.push(`  ${name}: {`);
    lines.push(`    subgraphName: '${config.subgraphName}',`);
    lines.push(`    hyperindexName: '${config.hyperindexName}',`);
    lines.push(`    fields: ${JSON.stringify(config.fields)},`);
    lines.push(`    nestedFields: ${JSON.stringify(config.nestedFields)},`);
    lines.push(`    fieldMapping: ${JSON.stringify(config.fieldMapping)}`);
    if (config.knownIdMismatch) {
      lines.push(`    knownIdMismatch: true`);
    }
    lines.push(`  }${comma}`);
  }

  lines.push('} as const;');
  lines.push('');
  lines.push('export type EntityName = keyof typeof ENTITY_CONFIGS;');
  lines.push('export type EntityConfig = typeof ENTITY_CONFIGS[EntityName];');

  return lines.join('\n');
}

/**
 * Load overrides from a JSON file
 */
export function loadOverrides(filePath: string): Overrides {
  // NOTE: this used `require('fs')`, which is undefined in this ESM package
  // ("type": "module"). The bare catch then swallowed the ReferenceError and
  // returned {}, so overrides.json was SILENTLY IGNORED on every run —
  // fieldMappings, knownIdMismatch, idMatchConfirmed and skipEntities all had
  // no effect. Failures are now reported instead of hidden.
  if (!existsSync(filePath)) {
    console.warn(`[overrides] not found: ${filePath} - continuing with no overrides`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Overrides;
  } catch (error) {
    console.warn(`[overrides] failed to parse ${filePath}: ${(error as Error).message}`);
    return {};
  }
}
