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
