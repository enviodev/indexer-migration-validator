import { GraphQLClient } from 'graphql-request';
import { HYPERINDEX_URL, ENTITY_CONFIGS, type EntityName } from '../config.js';

const client = new GraphQLClient(HYPERINDEX_URL);

/**
 * Build a HyperIndex query for fetching entity IDs
 */
function buildIdQuery(entityName: EntityName, limit: number, offset: number): string {
  const config = ENTITY_CONFIGS[entityName];
  return `
    query {
      ${config.hyperindexName}(limit: ${limit}, offset: ${offset}, order_by: {id: asc}) {
        id
      }
    }
  `;
}

/**
 * Build a HyperIndex query for fetching full entity data by IDs
 */
function buildDataQuery(entityName: EntityName, ids: string[]): string {
  const config = ENTITY_CONFIGS[entityName];
  const idsString = ids.map(id => `"${id}"`).join(', ');

  // Build field selection - HyperIndex uses _id suffix for foreign keys
  const fields = [...config.fields];
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

/**
 * Fetch entity IDs from HyperIndex
 */
export async function fetchIds(entityName: EntityName, limit: number, offset: number = 0): Promise<string[]> {
  const query = buildIdQuery(entityName, limit, offset);
  const config = ENTITY_CONFIGS[entityName];

  try {
    const result = await client.request<Record<string, Array<{ id: string }>>>(query);
    return result[config.hyperindexName]?.map(item => item.id) ?? [];
  } catch (error: any) {
    const msg = error?.response?.errors?.[0]?.message || error?.message || 'Unknown error';
    console.error(`[HyperIndex] Error fetching ${entityName} IDs: ${msg}`);
    return [];
  }
}

/**
 * Fetch full entity data by IDs from HyperIndex
 */
export async function fetchByIds(entityName: EntityName, ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];

  const query = buildDataQuery(entityName, ids);
  const config = ENTITY_CONFIGS[entityName];

  try {
    const result = await client.request<Record<string, Record<string, unknown>[]>>(query);
    return result[config.hyperindexName] ?? [];
  } catch (error: any) {
    const msg = error?.response?.errors?.[0]?.message || error?.message || 'Unknown error';
    console.error(`[HyperIndex] Error fetching ${entityName} data: ${msg}`);
    return [];
  }
}

/**
 * Get total count for an entity using aggregate query
 */
export async function fetchCount(entityName: EntityName): Promise<number> {
  const config = ENTITY_CONFIGS[entityName];
  const query = `
    query {
      ${config.hyperindexName}_aggregate {
        aggregate {
          count
        }
      }
    }
  `;

  try {
    const result = await client.request<Record<string, { aggregate: { count: number } }>>(query);
    return result[`${config.hyperindexName}_aggregate`]?.aggregate?.count ?? 0;
  } catch (error) {
    // Fallback to manual counting if aggregate not available
    console.warn(`[HyperIndex] Aggregate query failed for ${entityName}, using manual count`);
    let total = 0;
    let offset = 0;
    const batchSize = 1000;

    while (true) {
      const ids = await fetchIds(entityName, batchSize, offset);
      total += ids.length;
      if (ids.length < batchSize) break;
      offset += batchSize;
      if (offset > 100000) break;
    }

    return total;
  }
}

/**
 * Fetch ALL entity IDs using pagination
 */
export async function fetchAllIds(entityName: EntityName, onProgress?: (count: number) => void): Promise<string[]> {
  const allIds: string[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const ids = await fetchIds(entityName, batchSize, offset);
    allIds.push(...ids);

    if (onProgress) onProgress(allIds.length);

    if (ids.length < batchSize) break;
    offset += batchSize;

    // Safety limit - 100k records max
    if (offset > 100000) {
      console.warn(`[HyperIndex] Hit 100k limit for ${entityName}`);
      break;
    }
  }

  return allIds;
}

/**
 * Fetch full entity data for ALL IDs (with batching)
 */
export async function fetchAllByIds(
  entityName: EntityName,
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
