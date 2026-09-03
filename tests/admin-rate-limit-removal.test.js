import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('admin panel API paths bypass the global rate limiter', async () => {
  const source = await readFile('server/index.js', 'utf8');

  assert.match(source, /skip:\s*\(req\)\s*=>\s*req\.path\.startsWith\('\/health'\)\s*\|\|\s*isAdminPanelApiPath\(req\)/);
  assert.match(source, /apiPath\.startsWith\('\/admin'\)/);
  assert.match(source, /apiPath === '\/auth\/admin-login'/);
  assert.match(source, /apiPath\.startsWith\('\/auth\/admin\/'\)/);
  assert.match(source, /apiPath === '\/products\/smart-import'/);
  assert.match(source, /apiPath === '\/products\/admin\/catalog'/);
  assert.match(source, /apiPath\.startsWith\('\/orders\/admin\/'\)/);
  assert.match(source, /apiPath\.startsWith\('\/recommendations\/admin\/'\)/);
  assert.doesNotMatch(source, /adminMetricsLimiter/);
});

test('admin routes do not mount dedicated rate limit middleware', async () => {
  const [adminRoute, authRoute, productRoute, orderRoute] = await Promise.all([
    readFile('server/routes/admin.js', 'utf8'),
    readFile('server/routes/auth.js', 'utf8'),
    readFile('server/routes/products.js', 'utf8'),
    readFile('server/routes/orders.js', 'utf8')
  ]);

  assert.doesNotMatch(adminRoute, /adminManagementLimiter|createRateLimiter|rateLimitKeys/);
  assert.doesNotMatch(authRoute, /adminReadLimiter|adminWriteLimiter|auth:admin-read|auth:admin-write/);
  assert.doesNotMatch(productRoute, /adminProductWriteLimiter|products:admin-write/);
  assert.doesNotMatch(orderRoute, /router\.get\('\/admin\/list',\s*requireAdmin,\s*requireUserOperationsAdmin,\s*orderStatusLimiter/);
});
