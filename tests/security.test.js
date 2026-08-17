import assert from 'node:assert/strict';
import test from 'node:test';
import {
  developmentBillingBypass,
  isAllowedRasterImageUpload,
  isBlockedIp,
  isDevelopmentModeAllowed,
  safeFetchText,
  securityHeaders
} from '../server/utils/security.js';

function withEnv(overrides, fn) {
  const previous = {};
  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  });
  try {
    return fn();
  } finally {
    Object.keys(overrides).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('production never enables development billing bypass', () => {
  withEnv({ NODE_ENV: 'production', ENABLE_DEV_MODE: 'true' }, () => {
    assert.equal(isDevelopmentModeAllowed(), false);
    assert.equal(developmentBillingBypass({ devMode: true }), false);
  });
});

test('development billing bypass requires explicit server opt-in and user flag', () => {
  withEnv({ NODE_ENV: 'development', ENABLE_DEV_MODE: 'false' }, () => {
    assert.equal(developmentBillingBypass({ devMode: true }), false);
  });
  withEnv({ NODE_ENV: 'development', ENABLE_DEV_MODE: 'true' }, () => {
    assert.equal(developmentBillingBypass({ devMode: false }), false);
    assert.equal(developmentBillingBypass({ devMode: true }), true);
  });
});

test('SSRF guard rejects private, local, metadata, and reserved addresses', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1']) {
    assert.equal(isBlockedIp(address), true, `${address} should be blocked`);
    const host = address.includes(':') ? `[${address}]` : address;
    await assert.rejects(() => safeFetchText(`https://${host}/image.jpg`), /private|reserved|Localhost|allowed/i);
  }
  assert.equal(isBlockedIp('8.8.8.8'), false);
});

test('upload allowlist rejects SVG and arbitrary image MIME types', () => {
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'image/jpeg', originalname: 'photo.jpg' }), true);
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'image/png', originalname: 'photo.png' }), true);
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'image/webp', originalname: 'photo.webp' }), true);
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'image/svg+xml', originalname: 'payload.svg' }), false);
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'image/jpeg', originalname: 'payload.svg' }), false);
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'application/octet-stream', originalname: 'payload.jpg' }), true);
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'text/plain', originalname: 'payload.jpg' }), false);
  assert.equal(isAllowedRasterImageUpload({ mimetype: 'image/gif', originalname: 'payload.gif' }), false);
});

test('security headers include baseline browser hardening', () => {
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name.toLowerCase()] = value; } };
  securityHeaders({}, res, () => {});
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(headers['permissions-policy'], /camera=\(\)/);
});
