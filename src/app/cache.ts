import Redis from 'ioredis';
import config from './config';
import logger from './logger';
import { cacheRequests } from './metrics';

/**
 * Read-through cache on Valkey for user-independent read models.
 *
 * Invalidation uses a generation counter instead of per-key deletes: every cached article read model is
 * keyed by the current generation, and any write that can change one (article, favorite, follow, profile)
 * increments it. Old entries are never read again and expire through their TTL.
 *
 * The cache fails open: if Valkey is slow or down, requests go straight to PostgreSQL.
 * If invalidation itself fails, staleness is bounded by the TTLs.
 */

const GENERATION_KEY = 'gen:articles';

let client: Redis | null = null;
let lastErrorLogged = 0;

if (config.redisUrl) {
  client = new Redis(config.redisUrl, {
    enableOfflineQueue: false, // never queue: fail fast and fall back to PostgreSQL
    maxRetriesPerRequest: 1,
    commandTimeout: 250,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });
  client.on('ready', () => logger.info('cache connected'));
  client.on('error', (err) => {
    // Reconnect loops emit an error per attempt; log at most once a minute.
    if (Date.now() - lastErrorLogged > 60_000) {
      lastErrorLogged = Date.now();
      logger.warn({ err: err.message }, 'cache unavailable, serving from database');
    }
  });
} else {
  logger.info('REDIS_URL not set, cache disabled');
}

const withCache = async <T>(op: (redis: Redis) => Promise<T>): Promise<T | undefined> => {
  if (!client || client.status !== 'ready') {
    return undefined;
  }
  try {
    return await op(client);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'cache operation failed');
    return undefined;
  }
};

/** Returns the cached value for `name:key`, or loads it, caches it for `ttlSeconds` and returns it. */
export const cached = async <T>(
  name: string,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> => {
  const generation = await withCache((redis) => redis.get(GENERATION_KEY));
  const fullKey = generation === undefined ? undefined : `${name}:${generation ?? '0'}:${key}`;

  if (fullKey) {
    const hit = await withCache((redis) => redis.get(fullKey));
    if (hit !== undefined && hit !== null) {
      cacheRequests.inc({ cache: name, result: 'hit' });
      return JSON.parse(hit) as T;
    }
    cacheRequests.inc({ cache: name, result: hit === undefined ? 'error' : 'miss' });
  }

  const value = await load();
  if (fullKey) {
    void withCache((redis) => redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds));
  }
  return value;
};

/** Call after any write that can change an article read model or the tag list. */
export const invalidateArticles = async (): Promise<void> => {
  await withCache((redis) => redis.incr(GENERATION_KEY));
};

export const cacheStatus = async (): Promise<'ok' | 'down' | 'disabled'> => {
  if (!client) return 'disabled';
  const pong = await withCache((redis) => redis.ping());
  return pong === 'PONG' ? 'ok' : 'down';
};

export const closeCache = async (): Promise<void> => {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
  }
};
