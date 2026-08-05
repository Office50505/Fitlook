import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createHybridCache } from '../server/utils/cache.js';

test('hybrid cache coalesces concurrent misses for the same key', async () => {
  const previousRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;

  try {
    const cache = createHybridCache(`test:coalesce:${Date.now()}`, { ttlMs: 1000, maxItems: 10 });
    let loads = 0;
    const values = await Promise.all(Array.from({ length: 20 }, () => cache.remember('hot-key', async () => {
      loads += 1;
      await delay(10);
      return { ok: true, loads };
    })));

    assert.equal(loads, 1);
    assert.deepEqual([...new Set(values.map((value) => value.loads))], [1]);

    const cached = await cache.remember('hot-key', async () => {
      loads += 1;
      return { ok: false, loads };
    });

    assert.deepEqual(cached, { ok: true, loads: 1 });
    assert.equal(loads, 1);
  } finally {
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  }
});
