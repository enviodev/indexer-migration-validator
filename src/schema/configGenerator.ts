// Config Generator - generates EntityConfig from matched schemas
import {
  ParsedSchema,
  EntityMatch,
  GeneratedEntityConfig,
  ConfigWarning,
  GeneratorResult,
  Overrides,
} from './types.js';
import { matchSchemas } from './matcher.js';

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

  const knownIdMismatchSet = new Set(overrides?.knownIdMismatch || []);

  for (const match of matchResult.matches) {
    const config = generateEntityConfig(match, knownIdMismatchSet);
    configs[match.subgraphEntity.name] = config;

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
    unmatchedHyperindexEntities: matchResult.unmatchedHyperindex
  };
}

/**
 * Generate a single entity config from an EntityMatch
 */
function generateEntityConfig(
  match: EntityMatch,
  knownIdMismatch: Set<string>
): GeneratedEntityConfig {
  const { subgraphEntity, fieldMappings } = match;

  // Generate query names
  const subgraphName = toSubgraphQueryName(subgraphEntity.name);
  const hyperindexName = subgraphEntity.name; // HyperIndex uses PascalCase singular

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
        // For renamed fields, we store in fieldMapping and include the hyperindex field name in fields
        fieldMapping[mapping.subgraphField] = mapping.hyperindexField;
        fields.push(mapping.hyperindexField);
        break;
      case 'type_converted':
        fields.push(mapping.subgraphField);
        break;
    }
  }

  // Detect if ID formats likely differ
  const hasKnownIdMismatch = knownIdMismatch.has(subgraphEntity.name) ||
    detectIdMismatch(subgraphEntity.name);

  return {
    subgraphName,
    hyperindexName,
    fields,
    nestedFields,
    fieldMapping,
    knownIdMismatch: hasKnownIdMismatch
  };
}

/**
 * Convert entity name to subgraph query name (plural camelCase)
 */
function toSubgraphQueryName(entityName: string): string {
  // Handle special cases based on actual subgraph conventions
  const specialCases: Record<string, string> = {
    'NFTLookup': 'nftlookups',
    'PoolFees': 'poolFees', // Already plural-ish, keep as is
    'Activity': 'activities',
    'TokenDayData': 'tokenDayDatas',
    'TokenHourData': 'tokenHourDatas',
    'TokenMinuteData': 'tokenMinuteDatas',
    'Token15MinuteData': 'token15MinuteDatas',
    'Token4HourData': 'token4HourDatas',
    'CollectionMetadata': 'collectionMetadatas',
    'MemecoinTreasury': 'memecoinTreasuries',
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
  try {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Overrides;
  } catch (error) {
    // Return empty overrides if file doesn't exist or is invalid
    return {};
  }
}
