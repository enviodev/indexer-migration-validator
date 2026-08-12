import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import {
  type EntityDiff,
  type FieldDiffBreakdown,
  bucketFieldDiffs,
  getSignificantMismatches,
} from '../comparators/diff.js';

/**
 * Cap on stored mismatch EXAMPLES per entity. Counts are always exact and come
 * from the bucket breakdown; this only bounds the size of the evidence list so
 * a 900k-row entity cannot produce an unopenable report.
 */
const MAX_STORED_EXAMPLES = 1000;

export interface ComparisonReport {
  timestamp: string;
  summary: {
    totalEntities: number;
    entitiesWithIssues: number;
    totalSubgraphRecords: number;
    totalHyperindexRecords: number;
    totalMatched: number;
    totalMismatched: number;
    totalMissingInHyperindex: number;
    totalMissingInSubgraph: number;
  };
  entities: Record<string, EntityReport>;
}

export interface EntityReport {
  subgraphCount: number;
  hyperindexCount: number;
  matchedCount: number;
  mismatchedCount: number;
  /** Rows actually field-compared. Less than subgraphCount when --deep-limit bit. */
  comparedCount: number;
  /** True when --deep-limit truncated the field comparison for this entity. */
  comparisonTruncated: boolean;
  missingInHyperindex: string[];
  missingInSubgraph: string[];
  /** Exact bucket counts over ALL mismatches, overall and per field. */
  fieldDiffs: FieldDiffBreakdown;
  /** Evidence, capped at MAX_STORED_EXAMPLES. Counts live in fieldDiffs. */
  fieldMismatchExamples: Array<{
    id: string;
    field: string;
    subgraphValue: unknown;
    hyperindexValue: unknown;
    diffPercent?: number;
  }>;
  fieldMismatchExamplesTruncated: boolean;
}

/**
 * Generate a full JSON report from all entity diffs
 */
export function generateReport(diffs: EntityDiff[]): ComparisonReport {
  const timestamp = new Date().toISOString();

  let totalSubgraphRecords = 0;
  let totalHyperindexRecords = 0;
  let totalMatched = 0;
  let totalMismatched = 0;
  let totalMissingInHyperindex = 0;
  let totalMissingInSubgraph = 0;
  let entitiesWithIssues = 0;

  const entities: Record<string, EntityReport> = {};

  for (const diff of diffs) {
    totalSubgraphRecords += diff.subgraphCount;
    totalHyperindexRecords += diff.hyperindexCount;
    totalMatched += diff.matchedCount;
    totalMismatched += diff.mismatchedCount;
    totalMissingInHyperindex += diff.missingInHyperindex.length;
    totalMissingInSubgraph += diff.missingInSubgraph.length;

    const significantMismatches = getSignificantMismatches(diff);
    if (diff.missingInHyperindex.length > 0 || significantMismatches.length > 0) {
      entitiesWithIssues++;
    }

    // Bucket over ALL mismatches, not just the significant ones. The report
    // previously stored only getSignificantMismatches(), which keeps non-numeric
    // diffs and anything >= 1% and DISCARDS the rest — erasing the entire
    // BigDecimal rounding class, the single largest category of difference in
    // this migration, and making a "0 field mismatches" entity ambiguous
    // between genuinely clean and clean-above-1%.
    const fieldDiffs = bucketFieldDiffs(diff.fieldMismatches);

    // Prefer the largest differences as evidence: if the list must be cut, the
    // rows worth eyeballing are the ones that moved most, not the first 1000
    // by id order.
    // Non-numeric diffs rank first (no magnitude, always worth seeing), then by
    // descending magnitude. Not a subtraction: two non-numeric diffs would give
    // Infinity - Infinity = NaN, which is not a valid comparator result.
    const rank = (p: number | undefined) => (p === undefined ? Infinity : p);
    const ranked = [...diff.fieldMismatches].sort((a, b) => {
      const [ra, rb] = [rank(a.diffPercent), rank(b.diffPercent)];
      return ra === rb ? 0 : rb > ra ? 1 : -1;
    });

    entities[diff.entityName] = {
      subgraphCount: diff.subgraphCount,
      hyperindexCount: diff.hyperindexCount,
      matchedCount: diff.matchedCount,
      mismatchedCount: diff.mismatchedCount,
      comparedCount: diff.matchedCount + diff.mismatchedCount,
      comparisonTruncated: diff.comparisonTruncated ?? false,
      missingInHyperindex: diff.missingInHyperindex,
      missingInSubgraph: diff.missingInSubgraph,
      fieldDiffs,
      fieldMismatchExamples: ranked.slice(0, MAX_STORED_EXAMPLES).map(m => ({
        id: m.id,
        field: m.field,
        subgraphValue: m.subgraphValue,
        hyperindexValue: m.hyperindexValue,
        diffPercent: m.diffPercent
      })),
      fieldMismatchExamplesTruncated: ranked.length > MAX_STORED_EXAMPLES
    };
  }

  return {
    timestamp,
    summary: {
      totalEntities: diffs.length,
      entitiesWithIssues,
      totalSubgraphRecords,
      totalHyperindexRecords,
      totalMatched,
      totalMismatched,
      totalMissingInHyperindex,
      totalMissingInSubgraph
    },
    entities
  };
}

/**
 * Save report to JSON file
 */
export function saveReport(report: ComparisonReport, outputPath: string): void {
  // Ensure output directory exists
  const dir = dirname(outputPath);
  mkdirSync(dir, { recursive: true });

  // Write report
  const json = JSON.stringify(report, null, 2);
  writeFileSync(outputPath, json, 'utf-8');

  console.log(`\nReport saved to: ${outputPath}`);
}

/**
 * Generate default output filename with timestamp
 */
export function getDefaultOutputPath(baseDir: string): string {
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return join(baseDir, `comparison-${timestamp}.json`);
}
