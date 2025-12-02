import { DISCREPANCY_THRESHOLD_PERCENT, type EntityName } from '../config.js';
import { getComparableFields } from './normalize.js';

export interface FieldMismatch {
  id: string;
  field: string;
  subgraphValue: unknown;
  hyperindexValue: unknown;
  diffPercent?: number; // For numeric fields
}

export interface EntityDiff {
  entityName: EntityName;
  subgraphCount: number;
  hyperindexCount: number;
  commonIds: string[];
  missingInHyperindex: string[];
  missingInSubgraph: string[];
  fieldMismatches: FieldMismatch[];
  matchedCount: number;
  mismatchedCount: number;
}

/**
 * Calculate diff between normalized subgraph and hyperindex data
 */
export function calculateDiff(
  entityName: EntityName,
  subgraphData: Map<string, Record<string, unknown>>,
  hyperindexData: Map<string, Record<string, unknown>>
): EntityDiff {
  const subgraphIds = new Set(subgraphData.keys());
  const hyperindexIds = new Set(hyperindexData.keys());

  // Find common IDs and missing ones
  const commonIds: string[] = [];
  const missingInHyperindex: string[] = [];
  const missingInSubgraph: string[] = [];

  for (const id of subgraphIds) {
    if (hyperindexIds.has(id)) {
      commonIds.push(id);
    } else {
      missingInHyperindex.push(id);
    }
  }

  for (const id of hyperindexIds) {
    if (!subgraphIds.has(id)) {
      missingInSubgraph.push(id);
    }
  }

  // Compare field values for common IDs
  const fieldMismatches: FieldMismatch[] = [];
  const fields = getComparableFields(entityName);
  let matchedCount = 0;
  let mismatchedCount = 0;

  for (const id of commonIds) {
    const subgraphRecord = subgraphData.get(id)!;
    const hyperindexRecord = hyperindexData.get(id)!;
    let hasAnyMismatch = false;

    for (const field of fields) {
      const subgraphValue = subgraphRecord[field];
      const hyperindexValue = hyperindexRecord[field];

      if (!valuesEqual(subgraphValue, hyperindexValue)) {
        hasAnyMismatch = true;
        const mismatch: FieldMismatch = {
          id,
          field,
          subgraphValue,
          hyperindexValue
        };

        // Calculate percentage diff for numeric values
        const diffPercent = calculatePercentDiff(subgraphValue, hyperindexValue);
        if (diffPercent !== null) {
          mismatch.diffPercent = diffPercent;
        }

        fieldMismatches.push(mismatch);
      }
    }

    if (hasAnyMismatch) {
      mismatchedCount++;
    } else {
      matchedCount++;
    }
  }

  return {
    entityName,
    subgraphCount: subgraphData.size,
    hyperindexCount: hyperindexData.size,
    commonIds,
    missingInHyperindex,
    missingInSubgraph,
    fieldMismatches,
    matchedCount,
    mismatchedCount
  };
}

/**
 * Check if two values are equal (with type coercion for numeric strings)
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  // Both null/undefined
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  // Both same type and value
  if (a === b) return true;

  // String comparison (case-insensitive for hex addresses)
  if (typeof a === 'string' && typeof b === 'string') {
    // Both hex addresses
    if (a.startsWith('0x') && b.startsWith('0x')) {
      return a.toLowerCase() === b.toLowerCase();
    }
    return a === b;
  }

  // Numeric comparison (handle BigInt string variations)
  if (isNumericString(a) && isNumericString(b)) {
    return normalizeNumeric(a as string) === normalizeNumeric(b as string);
  }

  return false;
}

/**
 * Check if value is a numeric string
 */
function isNumericString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^-?\d+\.?\d*$/.test(value);
}

/**
 * Normalize a numeric string for comparison
 */
function normalizeNumeric(value: string): string {
  // Remove leading zeros (except for "0")
  // Normalize decimal representation
  const num = parseFloat(value);
  if (Number.isNaN(num)) return value;

  // For very large numbers, use BigInt for integer part
  if (!value.includes('.') && value.length > 15) {
    try {
      return BigInt(value).toString();
    } catch {
      return value;
    }
  }

  return num.toString();
}

/**
 * Calculate percentage difference between two numeric values
 * Returns null if not both numeric
 */
function calculatePercentDiff(a: unknown, b: unknown): number | null {
  if (!isNumericString(a) || !isNumericString(b)) {
    return null;
  }

  const numA = parseFloat(a as string);
  const numB = parseFloat(b as string);

  if (Number.isNaN(numA) || Number.isNaN(numB)) {
    return null;
  }

  // Avoid division by zero
  if (numA === 0 && numB === 0) return 0;
  if (numA === 0) return 100;

  const diff = Math.abs(numA - numB);
  const percent = (diff / Math.abs(numA)) * 100;

  return Math.round(percent * 100) / 100; // Round to 2 decimal places
}

/**
 * Filter to get only significant mismatches (above threshold)
 */
export function getSignificantMismatches(diff: EntityDiff): FieldMismatch[] {
  return diff.fieldMismatches.filter(m => {
    // Non-numeric mismatches are always significant
    if (m.diffPercent === undefined) return true;
    // Numeric mismatches above threshold
    return m.diffPercent >= DISCREPANCY_THRESHOLD_PERCENT;
  });
}

/**
 * Group mismatches by ID for reporting
 */
export function groupMismatchesById(mismatches: FieldMismatch[]): Map<string, FieldMismatch[]> {
  const grouped = new Map<string, FieldMismatch[]>();

  for (const mismatch of mismatches) {
    const existing = grouped.get(mismatch.id) ?? [];
    existing.push(mismatch);
    grouped.set(mismatch.id, existing);
  }

  return grouped;
}
