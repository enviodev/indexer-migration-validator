import { type EntityDiff, getSignificantMismatches, groupMismatchesById, type FieldMismatch } from '../comparators/diff.js';

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

const MAX_FIELDS_IN_BREAKDOWN = 30;
const EXAMPLES_PER_FIELD = 3;

type FieldMismatchSummary = {
  field: string;
  count: number;
  examples: FieldMismatch[];
};

function pickBetterExample(current: FieldMismatch, candidate: FieldMismatch): FieldMismatch {
  const cur = current.diffPercent ?? -Infinity;
  const next = candidate.diffPercent ?? -Infinity;
  if (next > cur) return candidate;
  return current;
}

function summarizeMismatchesByField(mismatches: FieldMismatch[]): FieldMismatchSummary[] {
  const byField = new Map<string, FieldMismatchSummary>();

  for (const m of mismatches) {
    const existing = byField.get(m.field);
    if (!existing) {
      byField.set(m.field, { field: m.field, count: 1, examples: [m] });
      continue;
    }
    existing.count++;
    // Keep up to EXAMPLES_PER_FIELD, biased toward larger diffPercent for numeric fields.
    if (existing.examples.length < EXAMPLES_PER_FIELD) {
      existing.examples.push(m);
    } else {
      // Replace the "weakest" example if this one is stronger
      let weakestIdx = 0;
      for (let i = 1; i < existing.examples.length; i++) {
        const a = existing.examples[i].diffPercent ?? -Infinity;
        const b = existing.examples[weakestIdx].diffPercent ?? -Infinity;
        if (a < b) weakestIdx = i;
      }
      const weakest = existing.examples[weakestIdx];
      const stronger = pickBetterExample(weakest, m);
      if (stronger !== weakest) {
        existing.examples[weakestIdx] = stronger;
      }
    }
  }

  return [...byField.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.field.localeCompare(b.field);
  });
}

function formatMismatchExample(m: FieldMismatch): string {
  const diffStr = m.diffPercent !== undefined ? ` (${m.diffPercent}% diff)` : '';
  return `${c('dim', formatIdForDisplay(m.id))}: ${c('red', formatValue(m.subgraphValue))} vs ${c('green', formatValue(m.hyperindexValue))}${diffStr}`;
}

function estimateCommonIdsCount(diff: EntityDiff): number | null {
  // In both sample and deep modes, missingInHyperindex is a list of Subgraph IDs not found in HyperIndex.
  // So (subgraphCount - missingInHyperindex.length) is an estimate of the true common ID count.
  // Guard against negative values in edge cases.
  const est = diff.subgraphCount - diff.missingInHyperindex.length;
  if (!Number.isFinite(est) || est < 0) return null;
  return est;
}

/**
 * Print a single entity diff to console
 */
export function printEntityDiff(diff: EntityDiff): void {
  const significantMismatches = getSignificantMismatches(diff);
  const hasIssues = diff.missingInHyperindex.length > 0 ||
                    diff.missingInSubgraph.length > 0 ||
                    significantMismatches.length > 0 ||
                    diff.mismatchedCount > 0 ||
                    diff.suspectedIdMismatch;

  console.log('\n' + c('bold', `=== ${diff.entityName} ===`));

  // Counts
  console.log(`  Records: Subgraph=${c('cyan', String(diff.subgraphCount))}, HyperIndex=${c('cyan', String(diff.hyperindexCount))}`);
  const comparedCount = diff.matchedCount + diff.mismatchedCount;
  const commonEst = estimateCommonIdsCount(diff);
  const compareScope = commonEst !== null && commonEst !== comparedCount
    ? ` (compared ${comparedCount} of ~${commonEst} common IDs)`
    : '';
  console.log(`  Compared: ${c('green', String(diff.matchedCount))} matched, ${c('yellow', String(diff.mismatchedCount))} with differences${c('dim', compareScope)}`);

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
      diff.missingInHyperindex.forEach(id => console.log(`    - ${formatIdForDisplay(id)}`));
    } else {
      diff.missingInHyperindex.slice(0, 3).forEach(id => console.log(`    - ${formatIdForDisplay(id)}`));
      console.log(`    ... and ${diff.missingInHyperindex.length - 3} more`);
    }
  }

  if (diff.missingInSubgraph.length > 0) {
    console.log(`  ${c('yellow', `Missing in Subgraph: ${diff.missingInSubgraph.length}`)}`);
    if (diff.missingInSubgraph.length <= 5) {
      diff.missingInSubgraph.forEach(id => console.log(`    - ${formatIdForDisplay(id)}`));
    } else {
      diff.missingInSubgraph.slice(0, 3).forEach(id => console.log(`    - ${formatIdForDisplay(id)}`));
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

      console.log(`    ${c('dim', formatIdForDisplay(id))}:`);
      for (const m of mismatches) {
        const diffStr = m.diffPercent !== undefined
          ? ` (${m.diffPercent}% diff)`
          : '';
        console.log(`      ${m.field}: ${c('red', formatValue(m.subgraphValue))} vs ${c('green', formatValue(m.hyperindexValue))}${diffStr}`);
      }
      shown++;
    }

    // Per-field breakdown (so you can see which fields are wrong most often)
    const fieldSummary = summarizeMismatchesByField(significantMismatches);
    if (fieldSummary.length > 0) {
      console.log(`\n  ${c('bold', 'Field mismatch breakdown (significant only):')}`);
      const toShow = fieldSummary.slice(0, MAX_FIELDS_IN_BREAKDOWN);
      for (const s of toShow) {
        const examples = s.examples
          .slice()
          .sort((a, b) => (b.diffPercent ?? -Infinity) - (a.diffPercent ?? -Infinity))
          .slice(0, EXAMPLES_PER_FIELD);
        console.log(`    ${s.field}: ${c('yellow', String(s.count))} mismatches`);
        for (const ex of examples) {
          console.log(`      e.g. ${formatMismatchExample(ex)}`);
        }
      }
      if (fieldSummary.length > MAX_FIELDS_IN_BREAKDOWN) {
        console.log(`    ... and ${fieldSummary.length - MAX_FIELDS_IN_BREAKDOWN} more fields`);
      }
    }
  } else if (diff.fieldMismatches.length > 0) {
    // All differences are below threshold; show a few examples so user can judge
    console.log(`  ${c('yellow', `Sample differences (below 1% threshold, ${diff.fieldMismatches.length} total):`)}`);
    const grouped = groupMismatchesById(diff.fieldMismatches);
    let shown = 0;
    const maxIdsToShow = 2;

    for (const [id, mismatches] of grouped) {
      if (shown >= maxIdsToShow) {
        console.log(`    ... and ${grouped.size - maxIdsToShow} more IDs with small differences`);
        break;
      }
      console.log(`    ${c('dim', formatIdForDisplay(id))}:`);
      for (const m of mismatches) {
        const diffStr = m.diffPercent !== undefined
          ? ` (${m.diffPercent}% diff)`
          : '';
        console.log(`      ${m.field}: ${c('red', formatValue(m.subgraphValue))} vs ${c('green', formatValue(m.hyperindexValue))}${diffStr}`);
      }
      shown++;
    }
  }

  // Summary status
  if (!hasIssues) {
    console.log(`  ${c('green', 'Status: All records match!')}`);
  } else if (diff.mismatchedCount > 0 && significantMismatches.length === 0) {
    console.log(`  ${c('yellow', `Status: ${diff.mismatchedCount} records with differences (all below 1% threshold)`)}`);
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

  const entityStats: { name: string; status: 'ok' | 'warn' | 'error'; idMismatch?: boolean; diff: EntityDiff }[] = [];

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
    entityStats.push({ name: diff.entityName, status, idMismatch: diff.suspectedIdMismatch, diff });
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

  // Per-entity field mismatch counts (significant only)
  console.log('\nField mismatch counts (significant only):');
  for (const stat of entityStats) {
    const significantMismatches = getSignificantMismatches(stat.diff);
    if (significantMismatches.length === 0) continue;

    console.log(`  ${c('bold', stat.name)}:`);
    const fieldSummary = summarizeMismatchesByField(significantMismatches);
    const toShow = fieldSummary.slice(0, MAX_FIELDS_IN_BREAKDOWN);
    for (const s of toShow) {
      const examples = s.examples
        .slice()
        .sort((a, b) => (b.diffPercent ?? -Infinity) - (a.diffPercent ?? -Infinity))
        .slice(0, EXAMPLES_PER_FIELD);
      console.log(`    ${s.field}: ${c('yellow', String(s.count))}`);
      for (const ex of examples) {
        console.log(`      e.g. ${formatMismatchExample(ex)}`);
      }
    }
    if (fieldSummary.length > MAX_FIELDS_IN_BREAKDOWN) {
      console.log(`    ... and ${fieldSummary.length - MAX_FIELDS_IN_BREAKDOWN} more fields`);
    }
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
 * Convert Bytes ID to hex string if it's binary data
 */
function bytesToHex(bytes: string | Uint8Array): string {
  if (typeof bytes === 'string') {
    // Already a string - check if it's already hex
    if (bytes.startsWith('0x')) return bytes;
    // Check if it looks like binary garbage (non-printable chars)
    if (/[\x00-\x08\x0E-\x1F\x7F-\xFF]/.test(bytes)) {
      // Convert binary string to hex
      let hex = '0x';
      for (let i = 0; i < bytes.length; i++) {
        const charCode = bytes.charCodeAt(i);
        hex += charCode.toString(16).padStart(2, '0');
      }
      return hex;
    }
    return bytes;
  }
  // Uint8Array
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Format ID for display (full ID, no truncation)
 */
function formatIdForDisplay(id: string): string {
  return bytesToHex(id);
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
