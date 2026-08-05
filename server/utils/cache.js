import { createHash } from 'node:crypto';
import { createClient } from 'redis';

let redisClient = null;
let redisClientUrl = null;
let redisConnectPromise = null;
let redisDisabledUntil = 0;
let lastRedisWarningAt = 0;

function warnRedis(message) {
  const now = Date.now();
  if (now - lastRedisWarningAt < 30_000) return;
  lastRedisWarningAt = now;
  console.warn(`[cache] ${message}`);
}

function redisTimeoutMs() {
  return Number(process.env.REDIS_TIMEOUT_MS || 250);
}

function keyPrefix() {
  return process.env.REDIS_KEY_PREFIX || 'fitlook';
}

function withTimeout(promise, timeoutMs = redisTimeoutMs()) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Redis cache timeout')), timeoutMs);
    })
  ]);
}

async function getRedisClient() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || Date.now() < redisDisabledUntil) return null;
  if (redisClient?.isOpen && redisClientUrl === redisUrl) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;

  redisClient = createClient({ url: redisUrl });
  redisClientUrl = redisUrl;
  redisClient.on('error', (error) => {
    warnRedis(error.message || 'Redis cache error');
  });

  redisConnectPromise = withTimeout(redisClient.connect(), 1000)
    .then(() => redisClient)
    .catch((error) => {
      redisDisabledUntil = Date.now() + 10_000;
      warnRedis(error.message || 'Redis cache unavailable');
      redisClient?.destroy?.();
      redisClient = null;
      redisClientUrl = null;
      return null;
    })
    .finally(() => {
      redisConnectPromise = null;
    });

  return redisConnectPromise;
}

function stableHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

function ttlSeconds(ttlMs) {
  const parsed = Number(ttlMs);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.max(1, Math.ceil(parsed / 1000));
}

function getLocalCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setLocalCacheEntry(cache, key, value, ttlMs, maxItems) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (cache.size > maxItems) cache.delete(cache.keys().next().value);
  return value;
}

function createHybridCache(name, options = {}) {
  const localCache = new Map();
  const inFlightLoads = new Map();
  const ttlMs = Number(options.ttlMs || 30_000);
  const maxItems = Number(options.maxItems || 150);
  let localVersion = 0;

  function namespace() {
    return `${keyPrefix()}:${name}`;
  }

  function versionKey() {
    return `${namespace()}:version`;
  }

  async function currentVersion() {
    const redis = await getRedisClient();
    if (!redis) return localVersion;
    try {
      return (await withTimeout(redis.get(versionKey()))) || '0';
    } catch (error) {
      warnRedis(error.message || 'Redis cache version unavailable');
      return localVersion;
    }
  }

  async function redisKeyFor(key) {
    return `${namespace()}:v${await currentVersion()}:${stableHash(key)}`;
  }

  async function getByRedisKey(redisKey) {
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await withTimeout(redis.get(redisKey));
        if (cached) return JSON.parse(cached);
      } catch (error) {
        warnRedis(error.message || 'Redis cache read failed');
      }
    }
    return getLocalCacheEntry(localCache, redisKey);
  }

  async function setByRedisKey(redisKey, value) {
    setLocalCacheEntry(localCache, redisKey, value, ttlMs, maxItems);
    const redis = await getRedisClient();
    if (redis) {
      try {
        await withTimeout(redis.setEx(redisKey, ttlSeconds(ttlMs), JSON.stringify(value)));
      } catch (error) {
        warnRedis(error.message || 'Redis cache write failed');
      }
    }
    return value;
  }

  async function get(key) {
    return getByRedisKey(await redisKeyFor(key));
  }

  async function set(key, value) {
    return setByRedisKey(await redisKeyFor(key), value);
  }

  async function remember(key, loader) {
    const redisKey = await redisKeyFor(key);
    const cached = await getByRedisKey(redisKey);
    if (cached !== null) return cached;
    if (inFlightLoads.has(redisKey)) return inFlightLoads.get(redisKey);

    const loadPromise = Promise.resolve()
      .then(loader)
      .then(async (value) => setByRedisKey(redisKey, value))
      .finally(() => {
        inFlightLoads.delete(redisKey);
      });
    inFlightLoads.set(redisKey, loadPromise);
    return loadPromise;
  }

  async function clear() {
    localCache.clear();
    inFlightLoads.clear();
    localVersion += 1;
    const redis = await getRedisClient();
    if (redis) {
      try {
        await withTimeout(redis.incr(versionKey()));
      } catch (error) {
        warnRedis(error.message || 'Redis cache invalidation failed');
      }
    }
  }

  return { get, set, remember, clear };
}

export { createHybridCache };
