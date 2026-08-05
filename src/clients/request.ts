/**
 * Retrying, rate-limit-aware GraphQL request wrapper.
 *
 * WHY THIS EXISTS: both clients previously did `catch { return [] }`. Over a
 * multi-hour deep run a single timeout or 502 would therefore be reported as
 * "this entity has zero rows", which the diff renders as thousands of MISSING
 * ENTITIES — indistinguishable from a genuine migration bug, and pointing at
 * the wrong side. A comparison tool that turns infrastructure flakiness into
 * false findings is worse than one that stops.
 *
 * So: retry transient failures, and if they persist, THROW. A run that dies
 * loudly can be resumed; a run that silently invents missing rows cannot be
 * trusted at all.
 *
 * RATE LIMITS are handled separately from other transient errors. The hosted
 * HyperIndex endpoints return 429 under sustained paging, and a deep run over a
 * 170k-row table will trip that reliably. 429s get their own (larger) attempt
 * budget and a much longer backoff, honouring `Retry-After` when present —
 * treating them like a flaky socket just burns the retry budget and aborts a
 * run that would have succeeded a few seconds later.
 */
import type { GraphQLClient } from 'graphql-request';
import { getRuntimeOptions } from '../runtime.js';

/**
 * GraphQL errors are the server rejecting the QUERY — retrying won't help.
 * Note a 429 arrives as `response.error` (a string) with `response.status`,
 * NOT as a `response.errors` array, so it does not match here.
 */
function isQueryError(error: any): boolean {
  return Array.isArray(error?.response?.errors) && error.response.errors.length > 0;
}

function isRateLimit(error: any): boolean {
  const status = error?.response?.status;
  return status === 429 || status === 503;
}

/** Seconds from a `Retry-After` header, if the server sent one. */
function retryAfterMs(error: any): number | undefined {
  const headers = error?.response?.headers;
  const raw =
    typeof headers?.get === 'function'
      ? headers.get('retry-after')
      : headers?.['retry-after'];
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function describe(error: any): string {
  if (isRateLimit(error)) return `HTTP ${error.response.status} (rate limited)`;
  return (
    error?.response?.errors?.[0]?.message ||
    error?.message ||
    'Unknown error'
  );
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Global pacing gate.
 *
 * Every request goes through here, so a `--throttle-ms` of N guarantees at
 * least N ms between consecutive requests across all entities. Cheaper than
 * discovering the rate limit by tripping it.
 */
let lastRequestAt = 0;
async function pace(): Promise<void> {
  const { throttleMs } = getRuntimeOptions();
  if (!throttleMs) return;
  const wait = lastRequestAt + throttleMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export async function requestWithRetry<T>(
  client: GraphQLClient,
  query: string,
  label: string,
): Promise<T> {
  const { retries, retryBaseMs, rateLimitRetries, rateLimitBaseMs } = getRuntimeOptions();
  let lastError: any;

  // Rate limits get their own, larger budget — they are expected, not a fault.
  let attempt = 0;
  let rateLimitAttempts = 0;

  while (true) {
    attempt++;
    try {
      await pace();
      return await client.request<T>(query);
    } catch (error: any) {
      lastError = error;

      // A malformed query fails identically every time — fail fast so the
      // real problem (a bad field name, a missing entity) surfaces at once.
      if (isQueryError(error)) {
        throw new Error(
          `${label}: query rejected by server: ${describe(error)}\nQuery was:\n${query}`,
        );
      }

      const limited = isRateLimit(error);
      if (limited) {
        rateLimitAttempts++;
        attempt--; // rate limits don't consume the transient-error budget
        if (rateLimitAttempts > rateLimitRetries) break;
        const backoff =
          retryAfterMs(error) ??
          Math.min(rateLimitBaseMs * 2 ** (rateLimitAttempts - 1), 60_000);
        console.warn(
          `[rate-limit] ${label} backing off ${Math.round(backoff / 1000)}s ` +
            `(${rateLimitAttempts}/${rateLimitRetries})`,
        );
        await sleep(backoff);
        continue;
      }

      if (attempt >= retries) break;
      const delay = retryBaseMs * 2 ** (attempt - 1);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${retries} failed (${describe(error)}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `${label}: gave up after ${attempt} attempts and ${rateLimitAttempts} rate-limit backoffs: ` +
      `${describe(lastError)}. Aborting rather than reporting these rows as missing.`,
  );
}
