import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { deliverOtp } from '../server/utils/otpDelivery.js';

test('OTP delivery fails closed when no provider is configured', async () => {
  await assert.rejects(
    deliverOtp({ phone: '+919876543210', otp: '123456', purpose: 'signup' }, {}),
    /OTP delivery is not configured/
  );
});

test('OTP delivery posts the code to the configured webhook provider', async () => {
  const originalFetch = globalThis.fetch;
  let received = null;
  globalThis.fetch = async (url, options) => {
    received = { url, options };
    return { ok: true, status: 204 };
  };

  try {
    await deliverOtp(
      { phone: '+919876543210', otp: '123456', purpose: 'login' },
      {
        OTP_DELIVERY_PROVIDER: 'webhook',
        OTP_DELIVERY_WEBHOOK_URL: 'https://otp-provider.example/send',
        OTP_DELIVERY_WEBHOOK_TOKEN: 'secret-token'
      }
    );

    assert.equal(received.url, 'https://otp-provider.example/send');
    assert.equal(received.options.method, 'POST');
    assert.equal(received.options.headers.Authorization, 'Bearer secret-token');
    assert.deepEqual(JSON.parse(received.options.body), {
      phone: '+919876543210',
      otp: '123456',
      purpose: 'login'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OTP webhook delivery times out safely', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  try {
    await assert.rejects(
      deliverOtp(
        { phone: '+919876543210', otp: '123456', purpose: 'signup' },
        {
          OTP_DELIVERY_PROVIDER: 'webhook',
          OTP_DELIVERY_WEBHOOK_URL: 'https://otp-provider.example/send',
          OTP_DELIVERY_TIMEOUT_MS: '1000'
        }
      ),
      /timed out/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OTP webhook delivery rejects provider 4xx and 5xx responses safely', async () => {
  const originalFetch = globalThis.fetch;

  try {
    for (const status of [400, 503]) {
      globalThis.fetch = async () => ({ ok: false, status });
      await assert.rejects(
        deliverOtp(
          { phone: '+919876543210', otp: '123456', purpose: 'signup' },
          {
            OTP_DELIVERY_PROVIDER: 'webhook',
            OTP_DELIVERY_WEBHOOK_URL: 'https://otp-provider.example/send'
          }
        ),
        /rejected/
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OTP webhook delivery rejects malformed provider responses safely', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });

  try {
    await assert.rejects(
      deliverOtp(
        { phone: '+919876543210', otp: '123456', purpose: 'signup' },
        {
          OTP_DELIVERY_PROVIDER: 'webhook',
          OTP_DELIVERY_WEBHOOK_URL: 'https://otp-provider.example/send'
        }
      ),
      /invalid response/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mock OTP delivery writes only to server-local test storage and is blocked in production', async () => {
  const storePath = `/private/tmp/fitlook-otp-${Date.now()}-${Math.random()}.jsonl`;
  await deliverOtp(
    { phone: '+919876543210', otp: '123456', purpose: 'login' },
    {
      NODE_ENV: 'test',
      OTP_DELIVERY_PROVIDER: 'mock',
      OTP_MOCK_STORE_PATH: storePath
    }
  );

  const stored = (await fs.readFile(storePath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(stored.length, 1);
  assert.deepEqual({
    phone: stored[0].phone,
    otp: stored[0].otp,
    purpose: stored[0].purpose
  }, {
    phone: '+919876543210',
    otp: '123456',
    purpose: 'login'
  });

  await assert.rejects(
    deliverOtp(
      { phone: '+919876543210', otp: '654321', purpose: 'signup' },
      {
        NODE_ENV: 'production',
        OTP_DELIVERY_PROVIDER: 'mock',
        OTP_MOCK_STORE_PATH: storePath
      }
    ),
    /not allowed in production/
  );

  await fs.unlink(storePath).catch(() => {});
});
