import assert from 'node:assert/strict';
import test from 'node:test';
import { validateServerEnv } from '../server/utils/envValidation.js';

test('validateServerEnv requires production-critical values', () => {
  assert.throws(() => validateServerEnv({ MONGODB_URI: '', JWT_SECRET: '' }), /MONGODB_URI, JWT_SECRET/);
});

test('validateServerEnv reports partial feature configuration without failing startup', () => {
  const report = validateServerEnv({
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    PHONEPE_CLIENT_ID: 'id'
  });

  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /PhonePe payments/);
});

test('validateServerEnv warns when OTP webhook delivery is incomplete', () => {
  const report = validateServerEnv({
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    OTP_DELIVERY_PROVIDER: 'webhook'
  });

  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /OTP delivery webhook/);
});

test('validateServerEnv warns when mock OTP delivery is unsafe or incomplete', () => {
  const report = validateServerEnv({
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    NODE_ENV: 'production',
    OTP_DELIVERY_PROVIDER: 'mock'
  });

  assert.equal(report.warnings.length, 2);
  assert.match(report.warnings.join(' '), /Mock OTP delivery is not allowed in production/);
  assert.match(report.warnings.join(' '), /OTP_MOCK_STORE_PATH/);
});
