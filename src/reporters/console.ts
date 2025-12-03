import { type EntityDiff, getSignificantMismatches, groupMismatchesById } from '../comparators/diff.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function c(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Print a single entity diff to console
 */
export function printEntityDiff(diff: EntityDiff): void {
  const significantMismatches = getSignificantMismatches(diff);
  const hasIssues = diff.missingInHyperindex.length > 0 ||
                    diff.missingInSubgraph.length > 0 ||
                    significantMismatches.length > 0 ||
                    diff.suspectedIdMismatch;

  console.log('\n' + c('bold', `=== ${diff.entityName} ===`));

  // Counts
  console.log(`  Records: Subgraph=${c('cyan', String(diff.subgraphCount))}, HyperIndex=${c('cyan', String(diff.hyperindexCount))}`);
  console.log(`  Compared: ${c('green', String(diff.matchedCount))} matched, ${c('yellow', String(diff.mismatchedCount))} with differences`);

  // Suspected ID format mismatch
  if (diff.suspectedIdMismatch) {
    console.log(`  ${c('red', '⚠ SUSPECTED ID FORMAT MISMATCH!')}`);
    console.log(`  Both sources have records but NO common IDs found.`);
    console.log(`  This likely means the ID generation differs between subgraph and hyperindex.`);
    if (diff.sampleSubgraphIds && diff.sampleSubgraphIds.length > 0) {
      console.log(`  Sample Subgraph IDs:`);
      diff.sampleSubgraphIds.slice(0, 3).forEach(id => console.log(`    - ${id}`));
    }
    if (diff.sampleHyperindexIds && diff.sampleHyperindexIds.length > 0) {
      console.log(`  Sample HyperIndex IDs:`);
      diff.sampleHyperindexIds.slice(0, 3).forEach(id => console.log(`    - ${id}`));
    }
  }

  // Missing records
  if (diff.missingInHyperindex.length > 0) {
    console.log(`  ${c('red', `Missing in HyperIndex: ${diff.missingInHyperindex.length}`)}`);
    if (diff.missingInHyperindex.length <= 5) {
      diff.missingInHyperindex.forEach(id => console.log(`    - ${truncateId(id)}`));
    } else {
      diff.missingInHyperindex.slice(0, 3).forEach(id => console.log(`    - ${truncateId(id)}`));
      console.log(`    ... and ${diff.missingInHyperindex.length - 3} more`);
    }
  }

  if (diff.missingInSubgraph.length > 0) {
    console.log(`  ${c('yellow', `Missing in Subgraph: ${diff.missingInSubgraph.length}`)}`);
    if (diff.missingInSubgraph.length <= 5) {
      diff.missingInSubgraph.forEach(id => console.log(`    - ${truncateId(id)}`));
    } else {
      diff.missingInSubgraph.slice(0, 3).forEach(id => console.log(`    - ${truncateId(id)}`));
      console.log(`    ... and ${diff.missingInSubgraph.length - 3} more`);
    }
  }

  // Field mismatches
  if (significantMismatches.length > 0) {
    console.log(`  ${c('yellow', `Field Mismatches: ${significantMismatches.length}`)}`);

    const grouped = groupMismatchesById(significantMismatches);
    let shown = 0;
    const maxToShow = 5;

    for (const [id, mismatches] of grouped) {
      if (shown >= maxToShow) {
        console.log(`    ... and ${grouped.size - maxToShow} more IDs with mismatches`);
        break;
      }

      console.log(`    ${c('dim', truncateId(id))}:`);
      for (const m of mismatches.slice(0, 3)) {
        const diffStr = m.diffPercent !== undefined
          ? ` (${m.diffPercent}% diff)`
          : '';
        console.log(`      ${m.field}: ${c('red', formatValue(m.subgraphValue))} vs ${c('green', formatValue(m.hyperindexValue))}${diffStr}`);
      }
      if (mismatches.length > 3) {
        console.log(`      ... and ${mismatches.length - 3} more fields`);
      }
      shown++;
    }
  }

  // Summary status
  if (!hasIssues) {
    console.log(`  ${c('green', 'Status: All records match!')}`);
  }
}

/**
 * Print summary for all entity comparisons
 */
export function printSummary(diffs: EntityDiff[]): void {
  console.log('\n' + c('bold', '========== COMPARISON SUMMARY =========='));

  let totalSubgraph = 0;
  let totalHyperindex = 0;
  let totalMatched = 0;
  let totalMismatched = 0;
  let totalMissingInHyperindex = 0;
  let totalMissingInSubgraph = 0;

  const entityStats: { name: string; status: 'ok' | 'warn' | 'error'; idMismatch?: boolean }[] = [];

  for (const diff of diffs) {
    totalSubgraph += diff.subgraphCount;
    totalHyperindex += diff.hyperindexCount;
    totalMatched += diff.matchedCount;
    totalMismatched += diff.mismatchedCount;
    totalMissingInHyperindex += diff.missingInHyperindex.length;
    totalMissingInSubgraph += diff.missingInSubgraph.length;

    const significantMismatches = getSignificantMismatches(diff);
    let status: 'ok' | 'warn' | 'error' = 'ok';
    if (diff.suspectedIdMismatch || diff.missingInHyperindex.length > 0 || significantMismatches.length > 0) {
      status = 'error';
    } else if (diff.missingInSubgraph.length > 0 || diff.mismatchedCount > 0) {
      status = 'warn';
    }
    entityStats.push({ name: diff.entityName, status, idMismatch: diff.suspectedIdMismatch });
  }

  // Entity status list
  console.log('\nEntity Status:');
  for (const stat of entityStats) {
    const icon = stat.status === 'ok' ? c('green', 'OK') :
                 stat.status === 'warn' ? c('yellow', 'WARN') :
                 c('red', 'ERR');
    const idMismatchNote = stat.idMismatch ? c('red', ' (ID MISMATCH)') : '';
    console.log(`  [${icon}] ${stat.name}${idMismatchNote}`);
  }

  // Totals
  const idMismatchCount = entityStats.filter(s => s.idMismatch).length;
  console.log('\nTotals:');
  console.log(`  Total Subgraph Records: ${totalSubgraph}`);
  console.log(`  Total HyperIndex Records: ${totalHyperindex}`);
  console.log(`  ${c('green', `Matched: ${totalMatched}`)}`);
  console.log(`  ${c('yellow', `With Differences: ${totalMismatched}`)}`);
  console.log(`  ${c('red', `Missing in HyperIndex: ${totalMissingInHyperindex}`)}`);
  console.log(`  ${c('yellow', `Missing in Subgraph: ${totalMissingInSubgraph}`)}`);
  if (idMismatchCount > 0) {
    console.log(`  ${c('red', `Entities with ID Mismatch: ${idMismatchCount}`)}`);
  }

  // Overall status
  const overallOk = totalMissingInHyperindex === 0 &&
                    entityStats.every(s => s.status !== 'error');
  console.log('\n' + (overallOk
    ? c('green', 'Overall: Migration looks good!')
    : c('red', 'Overall: Issues detected - review above details')));
}

/**
 * Truncate long IDs for display
 */
function truncateId(id: string): string {
  if (id.length <= 20) return id;
  return `${id.slice(0, 10)}...${id.slice(-8)}`;
}

/**
 * Format value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    if (value.length > 30) {
      return `"${value.slice(0, 27)}..."`;
    }
    return `"${value}"`;
  }
  return String(value);
}
