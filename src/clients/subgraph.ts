import { GraphQLClient, gql } from 'graphql-request';
import { SUBGRAPH_URL, getEntityConfigs } from '../config.js';

const client = new GraphQLClient(SUBGRAPH_URL);

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
 * Build a subgraph query for fetching entity IDs
 */
function buildIdQuery(entityName: string, limit: number, skip: number): string {
  const config = getConfig(entityName);
  return `
    query {
      ${config.subgraphName}(first: ${limit}, skip: ${skip}, orderBy: id, orderDirection: asc) {
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
      ${config.subgraphName}(where: { id_in: [${idsString}] }, first: ${ids.length}) {
        ${fields.join('\n        ')}
      }
    }
  `;
}

/**
 * Fetch entity IDs from subgraph
 */
export async function fetchIds(entityName: string, limit: number, skip: number = 0): Promise<string[]> {
  const query = buildIdQuery(entityName, limit, skip);
  const config = getConfig(entityName);

  try {
    const result = await client.request<Record<string, Array<{ id: string }>>>(query);
    return result[config.subgraphName]?.map(item => item.id) ?? [];
  } catch (error: any) {
    const msg = error?.response?.errors?.[0]?.message || error?.message || 'Unknown error';
    console.error(`[Subgraph] Error fetching ${entityName} IDs: ${msg}`);
    return [];
  }
}

/**
 * Fetch full entity data by IDs from subgraph
 */
export async function fetchByIds(entityName: string, ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];

  const query = buildDataQuery(entityName, ids);
  const config = getConfig(entityName);

  try {
    const result = await client.request<Record<string, Record<string, unknown>[]>>(query);
    return result[config.subgraphName] ?? [];
  } catch (error: any) {
    const msg = error?.response?.errors?.[0]?.message || error?.message || 'Unknown error';
    console.error(`[Subgraph] Error fetching ${entityName} data: ${msg}`);
    return [];
  }
}

/**
 * Get total count for an entity (approximate via fetching all IDs)
 */
export async function fetchCount(entityName: string): Promise<number> {
  let total = 0;
  let skip = 0;
  const batchSize = 1000;

  while (true) {
    const ids = await fetchIds(entityName, batchSize, skip);
    total += ids.length;
    if (ids.length < batchSize) break;
    skip += batchSize;
    // Safety limit
    if (skip > 100000) break;
  }

  return total;
}

/**
 * Fetch ALL entity IDs using pagination
 */
export async function fetchAllIds(entityName: string, onProgress?: (count: number) => void): Promise<string[]> {
  const allIds: string[] = [];
  let skip = 0;
  const batchSize = 1000;

  while (true) {
    const ids = await fetchIds(entityName, batchSize, skip);
    allIds.push(...ids);

    if (onProgress) onProgress(allIds.length);

    if (ids.length < batchSize) break;
    skip += batchSize;

    // Safety limit - 100k records max
    if (skip > 100000) {
      console.warn(`[Subgraph] Hit 100k limit for ${entityName}`);
      break;
    }
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
  const batchSize = 100; // Smaller batch for full data queries

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);
    const batchData = await fetchByIds(entityName, batchIds);
    allData.push(...batchData);

    if (onProgress) onProgress(allData.length, ids.length);
  }

  return allData;
}
