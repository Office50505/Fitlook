import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import closetRoutes from './routes/closet.js';
import paymentRoutes from './routes/payments.js';
import productRoutes from './routes/products.js';
import recommendationRoutes from './routes/recommendations.js';
import tryOnRoutes from './routes/tryons.js';
import imageRoutes from './routes/images.js';
import jobRoutes from './routes/jobs.js';
import { requireAdmin } from './utils/adminAccess.js';
import { closeRedisClient, getRedisClient } from './utils/cache.js';
import { closeJobQueues } from './utils/jobQueue.js';
import { configureMongoSlowQueryLogging, observabilitySnapshot, requestLogger } from './utils/observability.js';
import { appRole, mongoConnectOptions, serviceMetadata } from './utils/runtime.js';
import { validateServerEnv } from './utils/envValidation.js';

dotenv.config();

if (!['api', 'all'].includes(appRole('api'))) {
  throw new Error(`APP_ROLE=${appRole('api')} cannot start the API server`);
}

const app = express();
const port = process.env.PORT || 5050;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const service = serviceMetadata('api');
let server = null;
let shuttingDown = false;

function allowedOrigins() {
  return [
    process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    process.env.ADMIN_ORIGIN || 'http://localhost:5174',
    ...(process.env.ALLOWED_ORIGINS || '').split(',')
  ]
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function shouldAllowLocalDevOrigins() {
  const value = String(process.env.ALLOW_LOCAL_ORIGINS || '').toLowerCase();
  if (['1', 'true', 'yes'].includes(value)) return true;
  return process.env.NODE_ENV !== 'production';
}

function isLocalDevOrigin(origin) {
  if (!shouldAllowLocalDevOrigins()) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    if (!['5173', '5174', '5175'].includes(url.port)) return false;
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname.startsWith('192.168.') ||
      url.hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname)
    );
  } catch {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins().includes(origin) || isLocalDevOrigin(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use(requestLogger);
app.use('/uploads', express.static(path.join(rootDir, 'uploads')));
app.use('/api/auth', authRoutes);
app.use('/api/closet', closetRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/products', productRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/tryons', tryOnRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/jobs', jobRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

app.get('/api/health/live', (_req, res) => {
  res.json({ ok: true, live: true, shuttingDown, ...service });
});

app.get('/api/health/ready', async (_req, res) => {
  const mongo = mongoose.connection.readyState === 1;
  let redis = true;
  if (process.env.REDIS_URL && ['1', 'true', 'yes', 'on'].includes(String(process.env.TEMP_SESSION_REQUIRE_REDIS || '').toLowerCase())) {
    redis = Boolean(await getRedisClient());
  }
  const ready = !shuttingDown && mongo && redis;
  res.status(ready ? 200 : 503).json({ ok: ready, ready, mongo, redis, shuttingDown, ...service });
});

app.get('/api/admin/metrics', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await observabilitySnapshot({ mongoose }));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  const isFileSizeError = error?.code === 'LIMIT_FILE_SIZE';
  const isUploadError = typeof error?.code === 'string' && error.code.startsWith('LIMIT_');
  const status = error?.statusCode || error?.status || (isFileSizeError ? 413 : isUploadError ? 400 : 500);
  const message = isFileSizeError
    ? 'Profile photo must be smaller than 8 MB.'
    : isUploadError
      ? 'Could not process the profile photo. Please choose a different image and try again.'
      : error?.message || 'Request failed.';

  console.error(`[api] ${req.method} ${req.originalUrl} failed:`, error);
  res.status(status).json({ message });
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', event: 'api_shutdown_started', signal, ...service }));

  const timeout = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', event: 'api_shutdown_timeout', signal, ...service }));
    process.exit(1);
  }, Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || 25_000));
  timeout.unref?.();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await closeJobQueues();
    await closeRedisClient();
    await mongoose.disconnect();
    clearTimeout(timeout);
    console.log(JSON.stringify({ level: 'info', event: 'api_shutdown_complete', signal, ...service }));
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error(JSON.stringify({ level: 'error', event: 'api_shutdown_failed', signal, error: error.message, ...service }));
    process.exit(1);
  }
}

async function start() {
  const envReport = validateServerEnv();
  envReport.warnings.forEach((warning) => console.warn(`[env] ${warning}`));

  configureMongoSlowQueryLogging(mongoose);
  await mongoose.connect(process.env.MONGODB_URI, mongoConnectOptions());

  server = app.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', event: 'api_started', port: Number(port), ...service }));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
