import { DISCREPANCY_THRESHOLD_PERCENT } from '../config.js';
import { getComparableFields } from './normalize.js';

export interface FieldMismatch {
  id: string;
  field: string;
  subgraphValue: unknown;
  hyperindexValue: unknown;
  diffPercent?: number; // For numeric fields
}

export interface EntityDiff {
  entityName: string;
  subgraphCount: number;
  hyperindexCount: number;
  commonIds: string[];
  missingInHyperindex: string[];
  missingInSubgraph: string[];
  fieldMismatches: FieldMismatch[];
  matchedCount: number;
  mismatchedCount: number;
  // ID mismatch detection
  suspectedIdMismatch?: boolean;
  sampleSubgraphIds?: string[];
  sampleHyperindexIds?: string[];
  /**
   * True when --deep-limit stopped the field comparison short of every common
   * row. Row COUNTS stay exhaustive either way; only the field comparison is
   * capped. Recorded because a clean result over a truncated comparison is not
   * the same claim as a clean result over the whole table, and a report that
   * cannot tell them apart overstates its coverage.
   */
  comparisonTruncated?: boolean;
}

/**
 * Calculate diff between normalized subgraph and hyperindex data
 */
export function calculateDiff(
  entityName: string,
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
 * Split a decimal string into an exact scaled integer: "0.00123" -> (123n, 5).
 */
function parseDecimal(value: string): { mantissa: bigint; scale: number } | null {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match) return null;
  const [, sign, whole, frac = ''] = match;
  if (whole === '' && frac === '') return null;
  const digits = `${whole || '0'}${frac}`;
  try {
    const magnitude = BigInt(digits);
    return { mantissa: sign === '-' ? -magnitude : magnitude, scale: frac.length };
  } catch {
    return null;
  }
}

/** Precision of the exact relative-difference quotient, in decimal digits. */
const REL_DIFF_DIGITS = 60n;

/**
 * Percentage difference between two numeric values, computed EXACTLY.
 *
 * Deliberately not `parseFloat`. These are BigDecimals carrying up to ~34
 * significant digits, and the differences that matter most here are tiny: the
 * accepted graph-node rounding class diverges around the 34th digit, and one
 * open finding sits at 4.1e-7 relative. Both collapse to exactly 0 under
 * double-precision subtraction, and the previous `Math.round(p * 100) / 100`
 * then flattened everything below 0.005% to 0 as well — so every small
 * difference reported as "0% different" and became indistinguishable from an
 * exact match. Scaled-BigInt arithmetic keeps them separable, which is what
 * lets the >0 / >0.1% / >1% buckets mean anything at the low end.
 *
 * Returns null when either side is not a numeric string — those differences are
 * real but have no meaningful magnitude, and are counted separately.
 */
function calculatePercentDiff(a: unknown, b: unknown): number | null {
  if (!isNumericString(a) || !isNumericString(b)) return null;

  const decA = parseDecimal(a as string);
  const decB = parseDecimal(b as string);
  if (!decA || !decB) return null;

  // Align both to a common scale so the subtraction is exact.
  const scale = Math.max(decA.scale, decB.scale);
  const lift = (d: { mantissa: bigint; scale: number }) =>
    d.mantissa * 10n ** BigInt(scale - d.scale);
  const intA = lift(decA);
  const intB = lift(decB);

  const delta = intA > intB ? intA - intB : intB - intA;
  if (delta === 0n) return 0;

  // Baseline is the subgraph value: a difference against 0 has no defined
  // relative magnitude, so report it as non-numeric rather than inventing 100%.
  const baseline = intA < 0n ? -intA : intA;
  if (baseline === 0n) return null;

  const quotient = (delta * 100n * 10n ** REL_DIFF_DIGITS) / baseline;
  return Number(quotient) / Number(10n ** REL_DIFF_DIGITS);
}

/**
 * Percentage thresholds for the reported buckets. These are RELATIVE
 * differences against the subgraph value, expressed as percentages.
 */
export const BUCKET_TENTH_PERCENT = 0.1;
export const BUCKET_ONE_PERCENT = 1;

/**
 * Below this relative percentage a numeric difference is a rounding artefact,
 * not a quantity. graph-node's BigDecimal carries ~34 significant digits, so
 * two correct implementations routinely disagree in the last digit or two —
 * around 1e-32 % relative. Nothing economically meaningful can hide down here,
 * and separating the class out keeps it from being confused with the genuinely
 * small findings (the open untracked-volume residue sits at ~4e-5 %, thirty
 * orders of magnitude above this line).
 */
export const ULP_RELATIVE_PERCENT = 1e-20;

export interface DiffBucketCounts {
  /** Any non-equal value, whatever its type or magnitude. */
  differingAtAll: number;
  /** Numeric differences with relative magnitude > 0.1 %. */
  overTenthPercent: number;
  /** Numeric differences with relative magnitude > 1 %. */
  overOnePercent: number;
  /**
   * Differences with no defined relative magnitude — addresses, ids, enums,
   * null-vs-value, and numeric comparisons against a zero baseline. Counted
   * separately because calling them "0 %" would understate them and "100 %"
   * would overstate them; neither is a measurement.
   */
  nonNumeric: number;
  /** Numeric, but below ULP_RELATIVE_PERCENT — BigDecimal rounding. */
  ulp: number;
}

export interface FieldDiffBreakdown extends DiffBucketCounts {
  /** Per-field counts, so a report can name WHICH fields moved. */
  byField: Record<string, DiffBucketCounts>;
  /** Largest relative percentage seen, or null if nothing numeric differed. */
  maxPercent: number | null;
}

function emptyCounts(): DiffBucketCounts {
  return { differingAtAll: 0, overTenthPercent: 0, overOnePercent: 0, nonNumeric: 0, ulp: 0 };
}

function tally(counts: DiffBucketCounts, m: FieldMismatch): void {
  counts.differingAtAll++;
  if (m.diffPercent === undefined) {
    counts.nonNumeric++;
    return;
  }
  if (m.diffPercent > BUCKET_ONE_PERCENT) counts.overOnePercent++;
  if (m.diffPercent > BUCKET_TENTH_PERCENT) counts.overTenthPercent++;
  if (m.diffPercent < ULP_RELATIVE_PERCENT) counts.ulp++;
}

/**
 * Bucket every field mismatch into the reported classes, overall and per field.
 */
export function bucketFieldDiffs(mismatches: FieldMismatch[]): FieldDiffBreakdown {
  const overall = emptyCounts();
  const byField: Record<string, DiffBucketCounts> = {};
  let maxPercent: number | null = null;

  for (const m of mismatches) {
    tally(overall, m);
    byField[m.field] ??= emptyCounts();
    tally(byField[m.field], m);
    if (m.diffPercent !== undefined && (maxPercent === null || m.diffPercent > maxPercent)) {
      maxPercent = m.diffPercent;
    }
  }

  return { ...overall, byField, maxPercent };
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
