import os from 'node:os';
import fs from 'node:fs/promises';
import { getRedisClient, withTimeout } from './cache.js';
import { serviceMetadata } from './runtime.js';

const startedAt = Date.now();
const endpointStats = new Map();
const slowRequestMs = Number(process.env.SLOW_REQUEST_MS || 1000);
const maxEndpoints = Number(process.env.REQUEST_METRICS_MAX_ENDPOINTS || 250);
const service = serviceMetadata('api');

function enabled(value, defaultValue = true) {
  const raw = String(value ?? '').toLowerCase();
  if (!raw) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function routeKey(req) {
  const routePath = req.route?.path;
  const baseUrl = req.baseUrl || '';
  if (routePath) return `${req.method} ${baseUrl}${routePath}`.replace(/\/+/g, '/').replace(':/', '://');
  return `${req.method} ${req.path}`;
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return Math.round(sorted[index] * 100) / 100;
}

function statsFor(key) {
  if (!endpointStats.has(key)) {
    endpointStats.set(key, {
      key,
      count: 0,
      errors: 0,
      totalMs: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: 0,
      samples: []
    });
  }
  while (endpointStats.size > maxEndpoints) endpointStats.delete(endpointStats.keys().next().value);
  return endpointStats.get(key);
}

function recordRequest({ key, statusCode, durationMs }) {
  const stats = statsFor(key);
  stats.count += 1;
  if (statusCode >= 500) stats.errors += 1;
  stats.totalMs += durationMs;
  stats.minMs = Math.min(stats.minMs, durationMs);
  stats.maxMs = Math.max(stats.maxMs, durationMs);
  stats.samples.push(durationMs);
  if (stats.samples.length > 256) stats.samples.shift();
}

function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const key = routeKey(req);
    recordRequest({ key, statusCode: res.statusCode, durationMs });

    if (!enabled(process.env.STRUCTURED_REQUEST_LOGS, true)) return;
    const level = res.statusCode >= 500 ? 'error' : durationMs >= slowRequestMs ? 'warn' : 'info';
    const log = {
      level,
      event: 'http_request',
      ...service,
      method: req.method,
      path: req.originalUrl,
      route: key,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      contentLength: Number(res.getHeader('content-length') || 0) || undefined,
      ip: req.ip,
      userAgent: req.get('user-agent')
    };
    console.log(JSON.stringify(log));
  });
  next();
}

function requestMetrics() {
  return [...endpointStats.values()]
    .map((stats) => ({
      endpoint: stats.key,
      requests: stats.count,
      errors: stats.errors,
      errorRate: stats.count ? Math.round((stats.errors / stats.count) * 10000) / 10000 : 0,
      avgMs: stats.count ? Math.round((stats.totalMs / stats.count) * 100) / 100 : 0,
      minMs: Number.isFinite(stats.minMs) ? Math.round(stats.minMs * 100) / 100 : 0,
      maxMs: Math.round(stats.maxMs * 100) / 100,
      p50Ms: percentile(stats.samples, 50),
      p95Ms: percentile(stats.samples, 95),
      p99Ms: percentile(stats.samples, 99)
    }))
    .sort((a, b) => b.requests - a.requests);
}

async function redisMetrics() {
  const redis = await getRedisClient();
  if (!redis) return { ok: false };
  const info = await withTimeout(redis.info()).catch(() => '');
  const metrics = { ok: true };
  for (const line of info.split('\n')) {
    const [key, value] = line.trim().split(':');
    if (!key || value === undefined) continue;
    if ([
      'redis_version',
      'connected_clients',
      'used_memory_human',
      'used_memory_peak_human',
      'total_commands_processed',
      'instantaneous_ops_per_sec',
      'keyspace_hits',
      'keyspace_misses',
      'expired_keys',
      'evicted_keys',
      'uptime_in_seconds'
    ].includes(key)) {
      metrics[key] = value;
    }
  }
  return metrics;
}

async function nginxMetrics() {
  const url = process.env.NGINX_STATUS_URL || 'http://127.0.0.1/nginx_status';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.NGINX_STATUS_TIMEOUT_MS || 500));
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    const text = await response.text();
    const active = Number(text.match(/Active connections:\s*(\d+)/i)?.[1] || 0);
    const accepts = text.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/m);
    const reading = Number(text.match(/Reading:\s*(\d+)/i)?.[1] || 0);
    const writing = Number(text.match(/Writing:\s*(\d+)/i)?.[1] || 0);
    const waiting = Number(text.match(/Waiting:\s*(\d+)/i)?.[1] || 0);
    return {
      ok: true,
      active,
      accepts: accepts ? Number(accepts[1]) : undefined,
      handled: accepts ? Number(accepts[2]) : undefined,
      requests: accepts ? Number(accepts[3]) : undefined,
      reading,
      writing,
      waiting
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function systemMetrics() {
  const memory = process.memoryUsage();
  const loadAverage = os.loadavg();
  const uptime = os.uptime();
  let network = null;
  try {
    const raw = await fs.readFile('/proc/net/dev', 'utf8');
    network = raw
      .split('\n')
      .slice(2)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [iface, rest = ''] = line.split(':');
        const fields = rest.trim().split(/\s+/).map(Number);
        return {
          interface: iface.trim(),
          rxBytes: fields[0],
          rxPackets: fields[1],
          txBytes: fields[8],
          txPackets: fields[9]
        };
      });
  } catch {
    network = null;
  }

  return {
    hostname: os.hostname(),
    role: service.role,
    instanceId: service.instanceId,
    uptimeSeconds: Math.round(uptime),
    loadAverage,
    cpuCount: os.cpus().length,
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      processRss: memory.rss,
      processHeapUsed: memory.heapUsed,
      processHeapTotal: memory.heapTotal
    },
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      startedAt: new Date(startedAt).toISOString()
    },
    network
  };
}

function configureMongoSlowQueryLogging(mongoose) {
  const thresholdMs = Number(process.env.MONGO_SLOW_QUERY_MS || 250);
  if (!enabled(process.env.MONGO_SLOW_QUERY_LOGS, true)) return;
  if (mongoose.__fitlookSlowQueryLoggingInstalled) return;
  mongoose.__fitlookSlowQueryLoggingInstalled = true;

  const originalQueryExec = mongoose.Query.prototype.exec;
  mongoose.Query.prototype.exec = async function timedQueryExec(...args) {
    const started = process.hrtime.bigint();
    try {
      return await originalQueryExec.apply(this, args);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (durationMs >= thresholdMs) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'mongo_slow_query',
          ...service,
          collection: this.mongooseCollection?.name,
          op: this.op,
          durationMs: Math.round(durationMs * 100) / 100,
          filter: this.getFilter?.(),
          options: this.getOptions?.()
        }));
      }
    }
  };

  const originalAggregateExec = mongoose.Aggregate.prototype.exec;
  mongoose.Aggregate.prototype.exec = async function timedAggregateExec(...args) {
    const started = process.hrtime.bigint();
    try {
      return await originalAggregateExec.apply(this, args);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (durationMs >= thresholdMs) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'mongo_slow_aggregate',
          ...service,
          collection: this._model?.collection?.name,
          durationMs: Math.round(durationMs * 100) / 100,
          pipeline: this.pipeline?.()
        }));
      }
    }
  };
}

async function observabilitySnapshot({ mongoose } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    requests: requestMetrics(),
    system: await systemMetrics(),
    redis: await redisMetrics(),
    nginx: await nginxMetrics(),
    mongo: {
      ok: mongoose?.connection?.readyState === 1,
      readyState: mongoose?.connection?.readyState,
      host: mongoose?.connection?.host,
      name: mongoose?.connection?.name
    }
  };
}

export { configureMongoSlowQueryLogging, observabilitySnapshot, requestLogger, requestMetrics };
