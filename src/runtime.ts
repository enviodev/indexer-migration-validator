/**
 * Run-scoped options that every client needs to see.
 *
 * These are set once from the CLI before any query runs. They live here rather
 * than being threaded through every call because the client modules are plain
 * function exports consumed from several places.
 */

export interface RuntimeOptions {
  /**
   * Compare only one chain's slice of a multichain HyperIndex deployment.
   *
   * Envio prefixes entity IDs with `${chainId}-` when an indexer is multichain
   * while the subgraph was not. With this set, HyperIndex queries are filtered
   * to `id _like "<chainId>-%"` and the prefix is stripped from `id` and every
   * `*_id` foreign key before diffing, so IDs line up with the single-chain
   * subgraph. Leave unset for single-chain indexers that emit bare IDs.
   */
  chainId?: number;

  /**
   * Pin the subgraph side to a block via The Graph's time-travel argument.
   *
   * Without this the two endpoints are read at whatever height they each happen
   * to be at, so every mutable accumulator (Factory.txCount, Token.tradeVolume,
   * the DayData series) drifts and reports as a false mismatch. Set it to the
   * Envio side's `latest_processed_block`, which trails head by ~200 blocks for
   * reorg safety.
   */
  endBlock?: number;

  /** Attempts per request before giving up (transient errors). */
  retries: number;
  /** Base delay for exponential backoff, in ms. */
  retryBaseMs: number;
  /**
   * Separate, larger budget for HTTP 429/503. Sustained paging over a large
   * table WILL trip the hosted endpoints' rate limit; that is expected, not a
   * fault, so it must not consume the transient-error budget.
   */
  rateLimitRetries: number;
  /** Base backoff for rate limits, in ms. Capped at 60s per wait. */
  rateLimitBaseMs: number;
  /** Minimum ms between consecutive requests. 0 disables pacing. */
  throttleMs: number;

  /**
   * Entity-name prefix on the HyperIndex side.
   *
   * A MERGED indexer namespaces every entity by its source subgraph
   * (`Gauge` -> `Helper_Gauge`), so one endpoint can serve five migrations at
   * once. The prefix has to reach three places or the run fails: the schema
   * lookup that matches entities, the GraphQL query field, and — the one that
   * is easy to miss — the RESPONSE KEY the result is read back out of. Getting
   * the first two right and the third wrong yields `undefined` rows, which the
   * diff faithfully reports as "every row is missing".
   */
  entityPrefix?: string;

  /**
   * Pin the HYPERINDEX side to a block, the asymmetric partner to `endBlock`.
   *
   * The subgraph has The Graph's `block: { number: N }` time-travel; a
   * HyperIndex endpoint has nothing equivalent, so the only way to pin it is to
   * filter on the entity's own block column. Without this, any row the indexer
   * writes after the subgraph's pin shows up as pure `extra` with `0 missing` —
   * a difference that is an artefact of the two sides being read at different
   * heights, not a migration defect.
   *
   * Only usable on entities that HAVE a block column; mutable accumulators
   * (Gauge, User, LiquidityPosition, ...) do not, and are trustworthy only when
   * the indexer is stopped or caught up. Verify that at the end of every run.
   */
  hyperindexMaxBlock?: number;

}

/**
 * User-Agent sent on every request, by both clients.
 *
 * Goldsky returns HTTP 403 to a request that carries no User-Agent, and
 * graphql-request over Node's fetch sends none. An unset UA therefore makes
 * every Goldsky subgraph look dead — a previous campaign recorded three live
 * subgraphs as "disappeared" for exactly this reason.
 *
 * Deliberately a module constant rather than a RuntimeOptions field: the
 * clients construct their GraphQLClient at import time, which runs BEFORE the
 * CLI calls setRuntimeOptions(), so anything read from options there would
 * silently be the default anyway.
 */
export const USER_AGENT = 'indexer-migration-validator/1.0 (+parity-check)';

let options: RuntimeOptions = {
  retries: 5,
  retryBaseMs: 500,
  rateLimitRetries: 12,
  rateLimitBaseMs: 2_000,
  throttleMs: 0,
};

export function setRuntimeOptions(next: Partial<RuntimeOptions>): void {
  options = { ...options, ...next };
}

export function getRuntimeOptions(): RuntimeOptions {
  return options;
}

/** `"1776-"`, or undefined when not comparing a single chain. */
export function chainPrefix(): string | undefined {
  return options.chainId === undefined ? undefined : `${options.chainId}-`;
}

/**
 * The HyperIndex-side name for a subgraph entity: `Gauge` -> `Helper_Gauge`.
 *
 * Read through this everywhere rather than concatenating at the call site, so
 * the query field and the response key cannot drift apart.
 */
export function hyperindexEntityName(subgraphEntityName: string): string {
  return options.entityPrefix
    ? `${options.entityPrefix}${subgraphEntityName}`
    : subgraphEntityName;
}

/**
 * Strip a leading `<digits>-` chain prefix from an entity ID.
 *
 * Only applied when --chain is set, and only to ID-shaped values (`id` and
 * `*_id` columns) — never to arbitrary string fields, which may legitimately
 * start with digits and a dash.
 */
export function stripChainPrefix(value: string): string {
  if (options.chainId === undefined) return value;
  const prefix = `${options.chainId}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
