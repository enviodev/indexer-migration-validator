import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { type EntityDiff, getSignificantMismatches } from '../comparators/diff.js';

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
  missingInHyperindex: string[];
  missingInSubgraph: string[];
  fieldMismatches: Array<{
    id: string;
    field: string;
    subgraphValue: unknown;
    hyperindexValue: unknown;
    diffPercent?: number;
  }>;
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

    entities[diff.entityName] = {
      subgraphCount: diff.subgraphCount,
      hyperindexCount: diff.hyperindexCount,
      matchedCount: diff.matchedCount,
      mismatchedCount: diff.mismatchedCount,
      missingInHyperindex: diff.missingInHyperindex,
      missingInSubgraph: diff.missingInSubgraph,
      fieldMismatches: significantMismatches.map(m => ({
        id: m.id,
        field: m.field,
        subgraphValue: m.subgraphValue,
        hyperindexValue: m.hyperindexValue,
        diffPercent: m.diffPercent
      }))
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
