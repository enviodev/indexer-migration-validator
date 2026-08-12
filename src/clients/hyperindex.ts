import { GraphQLClient } from 'graphql-request';
import { HYPERINDEX_URL, getEntityConfigs } from '../config.js';
import { chainPrefix, stripChainPrefix, getRuntimeOptions, USER_AGENT } from '../runtime.js';
import { requestWithRetry } from './request.js';

const client = new GraphQLClient(HYPERINDEX_URL, {
  headers: { 'User-Agent': USER_AGENT },
});

const PAGE_SIZE = 1000;

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
 * Hasura `where` clause restricting results to one chain and/or a keyset cursor.
 *
 * A multichain Envio indexer prefixes every entity ID with `${chainId}-`, so
 * `id: {_like: "1776-%"}` is what isolates the slice that corresponds to a
 * single-chain subgraph. Without it, the other chains' rows show up as
 * "missing in subgraph" and swamp the real signal.
 */
function whereClause(entityName: string, after: string | null): string {
  const prefix = chainPrefix();
  const idClauses: string[] = [];
  if (prefix !== undefined) idClauses.push(`_like: "${prefix}%"`);
  if (after !== null) idClauses.push(`_gt: ${JSON.stringify(after)}`);

  const conditions: string[] = [];
  if (idClauses.length > 0) conditions.push(`id: {${idClauses.join(', ')}}`);

  // Pin this side to the same height as the subgraph's time-travel read.
  // Applies only to entities that actually have a block column — the rest are
  // mutable accumulators, unpinnable by construction.
  const { hyperindexMaxBlock } = getRuntimeOptions();
  const { blockField } = getConfig(entityName);
  if (hyperindexMaxBlock !== undefined && blockField) {
    conditions.push(`${blockField}: {_lte: "${hyperindexMaxBlock}"}`);
  }

  if (conditions.length === 0) return '';
  return `where: {${conditions.join(', ')}}, `;
}

/**
 * Keyset page of entity IDs.
 *
 * Offset pagination previously stopped dead at `offset > 100000`, quietly
 * truncating large entities. Seeking on `id _gt` removes that ceiling.
 */
function buildIdQuery(entityName: string, after: string | null): string {
  const config = getConfig(entityName);
  return `
    query {
      ${config.hyperindexName}(${whereClause(entityName, after)}limit: ${PAGE_SIZE}, order_by: {id: asc}) {
        id
      }
    }
  `;
}

/**
 * Build a HyperIndex query for fetching full entity data by IDs
 */
function buildDataQuery(entityName: string, ids: string[]): string {
  const config = getConfig(entityName);
  const idsString = ids.map(id => `"${id}"`).join(', ');

  // Build field selection - HyperIndex uses _id suffix for foreign keys
  // Translate renamed fields from subgraph names to hyperindex names
  const fieldMapping = config.fieldMapping || {};
  const fields: string[] = config.fields.map(field =>
    fieldMapping[field] || field
  );

  for (const [, hyperindexField] of Object.entries(config.nestedFields)) {
    fields.push(hyperindexField);
  }

  return `
    query {
      ${config.hyperindexName}(where: {id: {_in: [${idsString}]}}, limit: ${ids.length}) {
        ${fields.join('\n        ')}
      }
    }
  `;
}

async function fetchIdPage(entityName: string, after: string | null): Promise<string[]> {
  const config = getConfig(entityName);
  const query = buildIdQuery(entityName, after);
  const result = await requestWithRetry<Record<string, Array<{ id: string }>>>(
    client,
    query,
    `[HyperIndex] ${entityName} ids`,
  );
  return result[config.hyperindexName]?.map(item => item.id) ?? [];
}

/**
 * Re-apply the chain prefix to IDs that were stripped for comparison.
 *
 * IDs leave this module bare so they can be set-compared against the
 * single-chain subgraph, but the database still keys them prefixed — so any
 * lookup BY id has to put the prefix back.
 */
function toStoredId(id: string): string {
  const prefix = chainPrefix();
  if (prefix === undefined || id.startsWith(prefix)) return id;
  return `${prefix}${id}`;
}

/**
 * Fetch up to `limit` entity IDs (sampling path).
 *
 * Note the cursor pages on the RAW (prefixed) id — that is what Postgres
 * orders by — while the returned array is stripped for comparison.
 */
export async function fetchIds(entityName: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;

  while (ids.length < limit) {
    const page: string[] = await fetchIdPage(entityName, after);
    if (page.length === 0) break;
    ids.push(...page);
    after = page[page.length - 1]!;
    if (page.length < PAGE_SIZE) break;
  }

  return ids.slice(0, limit).map(stripChainPrefix);
}

/**
 * Fetch full entity data by IDs from HyperIndex
 */
export async function fetchByIds(entityName: string, ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];

  const config = getConfig(entityName);
  const query = buildDataQuery(entityName, ids.map(toStoredId));
  const result = await requestWithRetry<Record<string, Record<string, unknown>[]>>(
    client,
    query,
    `[HyperIndex] ${entityName} data`,
  );
  return result[config.hyperindexName] ?? [];
}

/**
 * Total row count.
 *
 * Aggregates are DISABLED on these deployments (`X_aggregate` fails validation),
 * so this always paginates. No cap.
 */
export async function fetchCount(entityName: string): Promise<number> {
  return (await fetchAllIds(entityName)).length;
}

/**
 * Fetch ALL entity IDs using keyset pagination. No 100k ceiling.
 */
export async function fetchAllIds(entityName: string, onProgress?: (count: number) => void): Promise<string[]> {
  const allIds: string[] = [];
  let after: string | null = null;

  while (true) {
    const page: string[] = await fetchIdPage(entityName, after);
    allIds.push(...page);

    if (onProgress) onProgress(allIds.length);

    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1]!;
  }

  // Stripped for comparison against the single-chain subgraph; fetchByIds puts
  // the prefix back when it looks rows up again.
  return allIds.map(stripChainPrefix);
}

/**
 * Fetch full entity data for ALL IDs (with batching)
 */
export async function fetchAllByIds(
  entityName: string,
  ids: string[],
  onProgress?: (fetched: number, total: number) => void
): Promise<Record<string, unknown>[]> {
  const allData: Record<string, unknown>[] = [];
  // 500 keeps us under the subgraph's `first: 1000` ceiling while issuing 5x
  // fewer requests than the old 100 — materially less rate-limit pressure on
  // a 170k-row table.
  const batchSize = 500;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);
    const batchData = await fetchByIds(entityName, batchIds);
    allData.push(...batchData);

    if (onProgress) onProgress(allData.length, ids.length);
  }

  return allData;
}
