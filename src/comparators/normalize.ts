import { ENTITY_CONFIGS, type EntityName } from '../config.js';

/**
 * Normalize a subgraph response to a flat format for comparison
 * - Flattens nested { field: { id } } to field_id
 * - Converts BigInt strings to strings for consistent comparison
 */
export function normalizeSubgraphResponse(
  entityName: EntityName,
  records: Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  const config = ENTITY_CONFIGS[entityName];
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
  entityName: EntityName,
  records: Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  const config = ENTITY_CONFIGS[entityName];
  const normalized = new Map<string, Record<string, unknown>>();

  for (const record of records) {
    const id = record.id as string;
    const flat: Record<string, unknown> = {};

    // Copy direct fields
    for (const field of config.fields) {
      flat[field] = normalizeValue(record[field]);
    }

    // Copy foreign key fields (already flat in HyperIndex)
    for (const flatField of Object.values(config.nestedFields)) {
      flat[flatField] = normalizeValue(record[flatField]);
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
export function getComparableFields(entityName: EntityName): string[] {
  const config = ENTITY_CONFIGS[entityName];
  return [
    ...config.fields,
    ...Object.values(config.nestedFields)
  ];
}
