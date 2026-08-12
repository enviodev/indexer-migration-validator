// Schema Matcher - matches entities and fields between subgraph and hyperindex schemas
import {
  ParsedSchema,
  ParsedEntity,
  ParsedField,
  FieldMapping,
  EntityMatch,
  MatchResult,
  Overrides,
} from './types.js';
import { getComparableFields } from './parser.js';
import { hyperindexEntityName } from '../runtime.js';

/**
 * Match entities between subgraph and hyperindex schemas
 */
export function matchSchemas(
  subgraphSchema: ParsedSchema,
  hyperindexSchema: ParsedSchema,
  overrides?: Overrides
): MatchResult {
  const matches: EntityMatch[] = [];
  const matchedHyperindexNames = new Set<string>();
  const skipEntities = new Set(overrides?.skipEntities || []);

  // Only match entities (has @entity in subgraph, or is a type in hyperindex)
  for (const [name, sgEntity] of subgraphSchema.entities) {
    // Skip non-entities and skipped entities
    if (!sgEntity.isEntity || skipEntities.has(name)) continue;

    // On a MERGED endpoint the hyperindex side namespaces every entity by its
    // source subgraph, so `Gauge` must resolve to `Helper_Gauge`. Try the
    // prefixed name first; without a prefix configured this is just `name`.
    const targetName = hyperindexEntityName(name);

    // Try exact name match first
    let hiEntity = hyperindexSchema.entities.get(targetName);

    // If not found, try case-insensitive match
    if (!hiEntity) {
      for (const [hiName, entity] of hyperindexSchema.entities) {
        if (hiName.toLowerCase() === targetName.toLowerCase()) {
          hiEntity = entity;
          break;
        }
      }
    }

    if (hiEntity) {
      matchedHyperindexNames.add(hiEntity.name);
      const entityOverrides = overrides?.fieldMappings?.[name] || {};
      // Fields the caller has explicitly excluded (overrides.skipFields).
      // Needed when a field cannot be SELECTED from one side at all — e.g. a
      // subgraph relation declared non-null whose target row is missing, which
      // makes the whole GraphQL response error and silently yield zero records.
      const entitySkipFields = overrides?.skipFields?.[name] || [];
      const fieldMappings = matchFields(sgEntity, hiEntity, entityOverrides, entitySkipFields);

      const skip = new Set(entitySkipFields);
      const sgComparableFields = getComparableFields(sgEntity).filter(f => !skip.has(f.name));
      const hiComparableFields = getComparableFields(hiEntity);

      // Find unmapped fields
      const mappedSgFields = new Set(fieldMappings.map(m => m.subgraphField));
      const mappedHiFields = new Set(fieldMappings.map(m => m.hyperindexField));

      const unmappedSubgraphFields = sgComparableFields
        .filter(f => !mappedSgFields.has(f.name))
        .map(f => f.name);

      const unmappedHyperindexFields = hiComparableFields
        .filter(f => !mappedHiFields.has(f.name))
        .map(f => f.name);

      matches.push({
        subgraphEntity: sgEntity,
        hyperindexEntity: hiEntity,
        confidence: calculateMatchConfidence(sgComparableFields.length, fieldMappings.length),
        fieldMappings,
        unmappedSubgraphFields,
        unmappedHyperindexFields,
      });
    }
  }

  // Find unmatched entities
  const unmatchedSubgraph = [...subgraphSchema.entities.values()]
    .filter(e => e.isEntity && !skipEntities.has(e.name) && !matches.some(m => m.subgraphEntity.name === e.name))
    .map(e => e.name);

  // A merged schema holds every source indexer's entities at once, so without
  // this filter a run against one source reports the other four's ~65 entities
  // as "unmatched" — noise that buries a genuine unmatched entity.
  const activePrefix = hyperindexEntityName('');
  const unmatchedHyperindex = [...hyperindexSchema.entities.keys()]
    .filter(name => !matchedHyperindexNames.has(name))
    .filter(name => name.startsWith(activePrefix));

  return { matches, unmatchedSubgraph, unmatchedHyperindex };
}

/**
 * Match fields between a subgraph entity and hyperindex entity
 */
function matchFields(
  sgEntity: ParsedEntity,
  hiEntity: ParsedEntity,
  overrides: Record<string, string>,
  skipFields: string[] = []
): FieldMapping[] {
  const mappings: FieldMapping[] = [];
  const hiFieldMap = new Map(hiEntity.fields.map(f => [f.name, f]));
  const hiFieldMapLower = new Map(hiEntity.fields.map(f => [f.name.toLowerCase(), f]));
  const usedHiFields = new Set<string>();

  // Fields the caller has explicitly excluded (overrides.skipFields). Needed
  // when a field cannot be SELECTED from one side at all — e.g. a subgraph
  // relation declared non-null whose target row is missing, which makes the
  // whole GraphQL response error out and silently yields zero records.
  const skip = new Set(skipFields);
  const sgComparableFields = getComparableFields(sgEntity).filter(f => !skip.has(f.name));

  for (const sgField of sgComparableFields) {
    // 1. Check overrides first
    if (overrides[sgField.name]) {
      const hiFieldName = overrides[sgField.name];
      if (hiFieldMap.has(hiFieldName)) {
        mappings.push({
          subgraphField: sgField.name,
          hyperindexField: hiFieldName,
          mappingType: 'renamed'
        });
        usedHiFields.add(hiFieldName);
        continue;
      }
    }

    // 2. Direct match (same name)
    const directMatch = hiFieldMap.get(sgField.name);
    if (directMatch && !sgField.isRelation && !usedHiFields.has(sgField.name)) {
      mappings.push({
        subgraphField: sgField.name,
        hyperindexField: sgField.name,
        mappingType: 'direct'
      });
      usedHiFields.add(sgField.name);
      continue;
    }

    // 3. Relation field -> flat FK (e.g., collectionToken -> collectionToken_id)
    if (sgField.isRelation) {
      const flatName = `${sgField.name}_id`;
      const flatMatch = hiFieldMap.get(flatName);
      if (flatMatch && !usedHiFields.has(flatName)) {
        mappings.push({
          subgraphField: sgField.name,
          hyperindexField: flatName,
          mappingType: 'nested_to_flat'
        });
        usedHiFields.add(flatName);
        continue;
      }
    }

    // 4. Check for common rename patterns
    const renamedMatch = findRenamedField(sgField, hiFieldMap, usedHiFields);
    if (renamedMatch) {
      mappings.push({
        subgraphField: sgField.name,
        hyperindexField: renamedMatch,
        mappingType: 'renamed'
      });
      usedHiFields.add(renamedMatch);
      continue;
    }
  }

  return mappings;
}

/**
 * Try to find a renamed field in the hyperindex schema
 */
function findRenamedField(
  sgField: ParsedField,
  hiFieldMap: Map<string, ParsedField>,
  usedHiFields: Set<string>
): string | null {
  // Known rename patterns
  const renamePatterns: Record<string, string[]> = {
    // subgraph field -> possible hyperindex names
    'native': ['isNative'],
    'type': ['activityType', 'swapType'],
    // Time series OHLC fields
    'open': ['priceOpen'],
    'high': ['priceHigh'],
    'low': ['priceLow'],
    'close': ['priceClose'],
    'openUSDC': ['priceOpenUSDC'],
    'highUSDC': ['priceHighUSDC'],
    'lowUSDC': ['priceLowUSDC'],
    'closeUSDC': ['priceCloseUSDC'],
  };

  // Check known patterns
  const patterns = renamePatterns[sgField.name];
  if (patterns) {
    for (const hiName of patterns) {
      if (hiFieldMap.has(hiName) && !usedHiFields.has(hiName)) {
        return hiName;
      }
    }
  }

  // Try adding common prefixes
  const prefixes = ['is', 'has', 'price'];
  for (const prefix of prefixes) {
    const prefixedName = prefix + sgField.name.charAt(0).toUpperCase() + sgField.name.slice(1);
    if (hiFieldMap.has(prefixedName) && !usedHiFields.has(prefixedName)) {
      return prefixedName;
    }
  }

  return null;
}

/**
 * Calculate match confidence based on mapped vs total fields
 */
function calculateMatchConfidence(totalFields: number, mappedFields: number): number {
  if (totalFields === 0) return 1.0;
  return mappedFields / totalFields;
}

/**
 * Get a summary of schema matching results
 */
export function getMatchSummary(result: MatchResult): string {
  const lines: string[] = [];

  lines.push(`\nSchema Matching Summary:`);
  lines.push(`========================`);
  lines.push(`Matched entities: ${result.matches.length}`);

  const highConfidence = result.matches.filter(m => m.confidence >= 0.8).length;
  const lowConfidence = result.matches.filter(m => m.confidence < 0.8).length;

  lines.push(`  High confidence (>=80%): ${highConfidence}`);
  lines.push(`  Low confidence (<80%): ${lowConfidence}`);

  if (result.unmatchedSubgraph.length > 0) {
    lines.push(`\nUnmatched subgraph entities (${result.unmatchedSubgraph.length}):`);
    result.unmatchedSubgraph.forEach(e => lines.push(`  - ${e}`));
  }

  if (result.unmatchedHyperindex.length > 0) {
    lines.push(`\nUnmatched hyperindex entities (${result.unmatchedHyperindex.length}):`);
    result.unmatchedHyperindex.forEach(e => lines.push(`  - ${e}`));
  }

  // Show low confidence matches
  const lowConfidenceMatches = result.matches.filter(m => m.confidence < 0.8);
  if (lowConfidenceMatches.length > 0) {
    lines.push(`\nLow confidence matches:`);
    for (const match of lowConfidenceMatches) {
      lines.push(`  ${match.subgraphEntity.name}: ${(match.confidence * 100).toFixed(0)}%`);
      if (match.unmappedSubgraphFields.length > 0) {
        lines.push(`    Missing in hyperindex: ${match.unmappedSubgraphFields.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}
