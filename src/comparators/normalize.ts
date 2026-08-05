import { getEntityConfigs } from '../config.js';
import { stripChainPrefix } from '../runtime.js';

/**
 * Get config for an entity
 */
function getConfig(entityName: string) {
  const configs = getEntityConfigs();
  const config = configs[entityName];
  if (!config) {
    throw new Error(`Unknown entity: ${entityName}`);
  }
  return config;
}

/**
 * Normalize a subgraph response to a flat format for comparison
 * - Flattens nested { field: { id } } to field_id
 * - Converts BigInt strings to strings for consistent comparison
 */
export function normalizeSubgraphResponse(
  entityName: string,
  records: Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  const config = getConfig(entityName);
  const normalized = new Map<string, Record<string, unknown>>();

  for (const record of records) {
    const id = record.id as string;
    const flat: Record<string, unknown> = {};

    // Copy direct fields
    for (const field of config.fields) {
      flat[field] = normalizeValue(record[field]);
    }

    // Flatten nested fields
    for (const [nestedField, flatField] of Object.entries(config.nestedFields)) {
      const nested = record[nestedField] as { id: string } | null | undefined;
      flat[flatField] = nested?.id ?? null;
    }

    normalized.set(id, flat);
  }

  return normalized;
}

/**
 * Normalize a HyperIndex response (already flat, just normalize values)
 */
export function normalizeHyperIndexResponse(
  entityName: string,
  records: Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  const config = getConfig(entityName);
  const normalized = new Map<string, Record<string, unknown>>();
  const fieldMapping = config.fieldMapping || {};

  for (const record of records) {
    // Keyed bare so the map lines up with the subgraph's unprefixed IDs.
    const id = stripChainPrefix(record.id as string);
    const flat: Record<string, unknown> = {};

    // Copy direct fields - translate renamed fields
    // config.fields contains subgraph field names
    // fieldMapping maps subgraph -> hyperindex for renamed fields
    for (const subgraphField of config.fields) {
      const hyperindexField = fieldMapping[subgraphField] || subgraphField;
      // Store using subgraph field name (for comparison with subgraph data)
      const value = normalizeValue(record[hyperindexField]);
      // `id` is also a comparable FIELD, not just the map key — strip it too,
      // or every row reports an `id` mismatch ("1776-0xabc" vs "0xabc") even
      // though the sets line up perfectly.
      flat[subgraphField] =
        subgraphField === 'id' && typeof value === 'string'
          ? stripChainPrefix(value)
          : value;
    }

    // Copy foreign key fields (already flat in HyperIndex).
    //
    // These hold ENTITY IDs, so on a multichain indexer they carry the chain
    // prefix too and must be stripped — otherwise every relation reports as a
    // mismatch ("1776-0xabc" vs "0xabc"). Applied only to FK columns, never to
    // ordinary string fields, which may legitimately look prefix-like.
    for (const flatField of Object.values(config.nestedFields)) {
      const value = normalizeValue(record[flatField]);
      flat[flatField] = typeof value === 'string' ? stripChainPrefix(value) : value;
    }

    normalized.set(id, flat);
  }

  return normalized;
}

/**
 * Normalize a single value for comparison
 * - Converts BigInt/BigDecimal strings to normalized format
 * - Handles null/undefined uniformly
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    // Check if it's a numeric string (BigInt/BigDecimal)
    if (/^-?\d+\.?\d*$/.test(value)) {
      // Keep as string but trim trailing zeros for decimals
      if (value.includes('.')) {
        return value.replace(/\.?0+$/, '') || '0';
      }
      return value;
    }
    // Lowercase for case-insensitive comparison of addresses etc
    if (value.startsWith('0x')) {
      return value.toLowerCase();
    }
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return value;
}

/**
 * Get all comparable field names for an entity
 */
export function getComparableFields(entityName: string): string[] {
  const config = getConfig(entityName);
  return [
    ...config.fields,
    ...Object.values(config.nestedFields)
  ];
}
