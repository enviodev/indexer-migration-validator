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
}

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
