import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('demo-mode public policy copy avoids internal demo/payment-provider language', async () => {
  const source = await fs.readFile('src/App.jsx', 'utf8');
  const start = source.indexOf("'/terms':", source.indexOf('const demoPolicyPages'));
  const end = source.indexOf('\nfunction policyForPath', start);
  assert.ok(start > 0 && end > start);
  const demoPolicyCopy = source.slice(start, end);

  assert.doesNotMatch(demoPolicyCopy, /\bdemo\b/i);
  assert.doesNotMatch(demoPolicyCopy, /simulated/i);
  assert.doesNotMatch(demoPolicyCopy, /No real/i);
  assert.doesNotMatch(demoPolicyCopy, /PhonePe/i);
});

test('demo storefront hides product ratings while keeping checkout copy ecommerce-first', async () => {
  const source = await fs.readFile('src/App.jsx', 'utf8');

  assert.match(source, /<h1 id="checkout-title">Checkout<\/h1>/);
  assert.match(source, /!\s*demoEcommerceMode && <p className="rating"/);
  assert.match(source, /!\s*demoEcommerceMode && <p className="product-editorial-rating"/);
  assert.match(source, /!\s*demoEcommerceMode && \{ id: 'top-rated'/);
});

test('signup duplicate responses redirect through login with a prefilled identifier', async () => {
  const appSource = await fs.readFile('src/App.jsx', 'utf8');
  const authSource = await fs.readFile('server/routes/auth.js', 'utf8');

  assert.match(authSource, /code:\s*'ACCOUNT_EXISTS'/);
  assert.match(appSource, /function loginHrefForIdentifier/);
  assert.match(appSource, /params\.set\('identifier'/);
  assert.match(appSource, /isExistingAccountError\(err\)/);
  assert.match(appSource, /Mobile number or email/);
});

test('demo token purchases cannot fall through to a payment redirect', async () => {
  const source = await fs.readFile('src/App.jsx', 'utf8');

  assert.match(source, /demoModeLoading/);
  assert.match(source, /demoModeError/);
  assert.match(source, /Checkout mode is active, but the server returned a payment redirect/);
  assert.match(source, /demoModeLoading \? 'Checking mode\.\.\.'/);
  assert.doesNotMatch(source, /Demo checkout confirms/);
  assert.doesNotMatch(source, /Live brand and price details/);
});
