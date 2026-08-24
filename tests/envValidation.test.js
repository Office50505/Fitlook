import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationReadiness, phonePeEnabled, validateServerEnv } from '../server/utils/envValidation.js';

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

test('validateServerEnv warns when OTP webhook delivery is incomplete outside production', () => {
  const report = validateServerEnv({
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    OTP_DELIVERY_PROVIDER: 'webhook'
  });

  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /OTP delivery webhook/);
});

test('validateServerEnv rejects unsafe OTP delivery but permits fail-closed OTP in production', () => {
  assert.throws(
    () => validateServerEnv({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost:27017/fitlook',
      JWT_SECRET: 'secret',
      OTP_DELIVERY_PROVIDER: 'mock',
      OTP_MOCK_STORE_PATH: '/tmp/otp.jsonl'
    }),
    /Production requires OTP_DELIVERY_PROVIDER=webhook or disabled/
  );

  assert.throws(
    () => validateServerEnv({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost:27017/fitlook',
      JWT_SECRET: 'secret',
      OTP_DELIVERY_PROVIDER: 'webhook',
      OTP_DELIVERY_WEBHOOK_URL: 'http://localhost:3000/otp'
    }),
    /HTTPS|localhost/
  );

  assert.doesNotThrow(() => validateServerEnv({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    OTP_DELIVERY_PROVIDER: 'disabled',
    PHONEPE_ENABLED: 'false'
  }));
});

test('PhonePe can be explicitly disabled without validating stale partial credentials', () => {
  const env = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    OTP_DELIVERY_PROVIDER: 'disabled',
    PHONEPE_ENABLED: 'false',
    PHONEPE_CLIENT_ID: 'partial'
  };

  assert.equal(phonePeEnabled(env), false);
  assert.deepEqual(validateServerEnv(env), { warnings: [] });
  assert.deepEqual(configurationReadiness(env), {
    otpProvider: 'disabled',
    otpProviderType: 'disabled',
    phonePe: 'disabled'
  });
});

test('partial PhonePe production configuration still fails when payments are enabled', () => {
  assert.throws(() => validateServerEnv({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    OTP_DELIVERY_PROVIDER: 'disabled',
    PHONEPE_ENABLED: 'true',
    PHONEPE_CLIENT_ID: 'partial'
  }), /PhonePe payments are partially configured/);
});

test('validateServerEnv warns when mock OTP delivery is incomplete outside production', () => {
  const report = validateServerEnv({
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    NODE_ENV: 'test',
    OTP_DELIVERY_PROVIDER: 'mock'
  });

  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings.join(' '), /OTP_MOCK_STORE_PATH/);
});

test('validateServerEnv rejects fixed OTP in production', () => {
  assert.throws(
    () => validateServerEnv({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost:27017/fitlook',
      JWT_SECRET: 'secret',
      OTP_DELIVERY_PROVIDER: 'webhook',
      OTP_DELIVERY_WEBHOOK_URL: 'https://otp-provider.example/send',
      OTP_FIXED_CODE: '123456'
    }),
    /OTP_FIXED_CODE is not allowed in production/
  );
});

test('validateServerEnv allows explicitly enabled fixed OTP in production', () => {
  const env = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    OTP_DELIVERY_PROVIDER: 'disabled',
    OTP_FIXED_CODE: '123456',
    ALLOW_FIXED_OTP_IN_PRODUCTION: 'true',
    PHONEPE_ENABLED: 'false'
  };

  assert.deepEqual(validateServerEnv(env), { warnings: [] });
  assert.deepEqual(configurationReadiness(env), {
    otpProvider: 'configured',
    otpProviderType: 'fixed',
    phonePe: 'disabled'
  });
});

test('validateServerEnv allows fixed OTP for staging mock delivery', () => {
  const report = validateServerEnv({
    NODE_ENV: 'staging',
    MONGODB_URI: 'mongodb://localhost:27017/fitlook',
    JWT_SECRET: 'secret',
    OTP_DELIVERY_PROVIDER: 'mock',
    OTP_MOCK_STORE_PATH: '/tmp/otp.jsonl',
    OTP_FIXED_CODE: '123456'
  });

  assert.equal(report.warnings.length, 0);
});
