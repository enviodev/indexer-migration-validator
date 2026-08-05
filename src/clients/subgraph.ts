import { GraphQLClient } from 'graphql-request';
import { SUBGRAPH_URL, getEntityConfigs } from '../config.js';
import { getRuntimeOptions } from '../runtime.js';
import { requestWithRetry } from './request.js';

const client = new GraphQLClient(SUBGRAPH_URL);

/** graph-node caps `first` at 1000 on every host we target. */
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
 * The Graph's time-travel argument, pinning the read to a block.
 *
 * Both sides must describe the same height or every mutable accumulator drifts.
 * Emitted as a query argument fragment, e.g. `, block: { number: 12345 }`.
 */
function blockArg(): string {
  const { endBlock } = getRuntimeOptions();
  return endBlock === undefined ? '' : `, block: { number: ${endBlock} }`;
}

/**
 * Keyset page of entity IDs, ordered by id.
 *
 * Deliberately NOT offset-based: the previous implementation paged with `skip`
 * and hard-stopped at 100k, silently truncating any larger entity (cl-analytics
 * Swap alone is ~225k rows) and reporting the remainder as missing. Seeking on
 * `id_gt` has no ceiling and stays correct however large the table grows.
 */
function buildIdQuery(entityName: string, after: string | null): string {
  const config = getConfig(entityName);
  const where = after === null ? '' : `, where: { id_gt: "${after}" }`;
  return `
    query {
      ${config.subgraphName}(first: ${PAGE_SIZE}, orderBy: id, orderDirection: asc${where}${blockArg()}) {
        id
      }
    }
  `;
}

/**
 * Build a subgraph query for fetching full entity data by IDs
 */
function buildDataQuery(entityName: string, ids: string[]): string {
  const config = getConfig(entityName);
  const idsString = ids.map(id => `"${id}"`).join(', ');

  // Build field selection including nested fields
  const fields: string[] = [...config.fields];
  for (const [nestedField] of Object.entries(config.nestedFields)) {
    fields.push(`${nestedField} { id }`);
  }

  return `
    query {
      ${config.subgraphName}(where: { id_in: [${idsString}] }, first: ${ids.length}${blockArg()}) {
        ${fields.join('\n        ')}
      }
    }
  `;
}

/**
 * Fetch one keyset page of IDs. Throws rather than returning [] on failure.
 */
async function fetchIdPage(entityName: string, after: string | null): Promise<string[]> {
  const config = getConfig(entityName);
  const query = buildIdQuery(entityName, after);
  const result = await requestWithRetry<Record<string, Array<{ id: string }>>>(
    client,
    query,
    `[Subgraph] ${entityName} ids`,
  );
  const records = result[config.subgraphName];
  if (!records) {
    throw new Error(
      `[Subgraph] No "${config.subgraphName}" key in response for ${entityName}. ` +
        `Check the entity's query name.`,
    );
  }
  return records.map(item => item.id);
}

/**
 * Fetch up to `limit` entity IDs (sampling path).
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

  return ids.slice(0, limit);
}

/**
 * Fetch full entity data by IDs from subgraph
 */
export async function fetchByIds(entityName: string, ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];

  const config = getConfig(entityName);
  const query = buildDataQuery(entityName, ids);
  const result = await requestWithRetry<Record<string, Record<string, unknown>[]>>(
    client,
    query,
    `[Subgraph] ${entityName} data`,
  );
  return result[config.subgraphName] ?? [];
}

/**
 * Total row count. No cap — pages until the table is exhausted.
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

  return allIds;
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
