import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amountForPlan,
  billingFrequencyForPlan,
  calculatePhonePeCallbackAuthorization,
  checkoutIdempotencyKey,
  configuredRedirectUrl,
  orderIdFromCallback,
  reconcileOrder,
  recurringAmountForPlan,
  statusFromPhonePeState,
  validatePhonePeCallbackAuth
} from '../server/routes/payments.js';
import TokenOrder from '../server/models/TokenOrder.js';
import User from '../server/models/User.js';
import { SUBSCRIPTION_PLAN, TOP_UP_PLANS } from '../shared/pricing.js';

function requestStub({ headers = {}, body = {}, query = {}, protocol = 'https', host = 'fitlook.in' } = {}) {
  return {
    body,
    query,
    protocol,
    get(name) {
      return headers[String(name).toLowerCase()] || headers[name] || (String(name).toLowerCase() === 'host' ? host : '');
    }
  };
}

test('PhonePe callback authorization follows current v2 SDK username/password hash contract', () => {
  const authorization = calculatePhonePeCallbackAuthorization('username', 'password');
  assert.equal(authorization, 'bc842c31a9e54efe320d30d948be61291f3ceee4766e36ab25fa65243cd76e0e');
  assert.equal(validatePhonePeCallbackAuth(authorization, {
    PHONEPE_CALLBACK_USERNAME: 'username',
    PHONEPE_CALLBACK_PASSWORD: 'password'
  }), true);
  assert.equal(validatePhonePeCallbackAuth('bad', {
    PHONEPE_CALLBACK_USERNAME: 'username',
    PHONEPE_CALLBACK_PASSWORD: 'password'
  }), false);
});

test('PhonePe callback order id extraction supports v2 payload shapes', () => {
  assert.equal(orderIdFromCallback(requestStub({ body: { payload: { merchantOrderId: 'FL_1' } } })), 'FL_1');
  assert.equal(orderIdFromCallback(requestStub({ body: { payload: { orderId: 'OMO_1' } } })), 'OMO_1');
  assert.equal(orderIdFromCallback(requestStub({ query: { merchantOrderId: 'FL_Q' } })), 'FL_Q');
});

test('PhonePe redirect URL is generated from approved server configuration', () => {
  const previousClientOrigin = process.env.CLIENT_ORIGIN;
  const previousRedirectUrl = process.env.PHONEPE_REDIRECT_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ORIGIN = 'https://fitlook.in';
    delete process.env.PHONEPE_REDIRECT_URL;
    const url = configuredRedirectUrl(requestStub(), 'FL_123', SUBSCRIPTION_PLAN.id);
    assert.equal(url, `https://fitlook.in/tokens?merchantOrderId=FL_123&plan=${SUBSCRIPTION_PLAN.id}`);

    process.env.PHONEPE_REDIRECT_URL = 'http://localhost:5173/tokens';
    assert.throws(() => configuredRedirectUrl(requestStub(), 'FL_123', SUBSCRIPTION_PLAN.id), /HTTPS|localhost/);

    process.env.PHONEPE_REDIRECT_URL = 'https://payments.example.com/tokens';
    assert.throws(() => configuredRedirectUrl(requestStub(), 'FL_123', SUBSCRIPTION_PLAN.id), /approved CLIENT_ORIGIN/);
  } finally {
    if (previousClientOrigin === undefined) delete process.env.CLIENT_ORIGIN;
    else process.env.CLIENT_ORIGIN = previousClientOrigin;
    if (previousRedirectUrl === undefined) delete process.env.PHONEPE_REDIRECT_URL;
    else process.env.PHONEPE_REDIRECT_URL = previousRedirectUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('payment amounts are derived server-side from shared pricing', () => {
  assert.equal(amountForPlan(SUBSCRIPTION_PLAN), SUBSCRIPTION_PLAN.dueTodayAmount);
  assert.equal(recurringAmountForPlan(SUBSCRIPTION_PLAN), SUBSCRIPTION_PLAN.mandate.recurringAmount);
  assert.equal(billingFrequencyForPlan(SUBSCRIPTION_PLAN), SUBSCRIPTION_PLAN.mandate.frequency);
  assert.equal(amountForPlan(TOP_UP_PLANS[0]), TOP_UP_PLANS[0].amount);
  assert.equal(recurringAmountForPlan(TOP_UP_PLANS[0]), null);
});

test('checkout idempotency key accepts only bounded opaque keys', () => {
  assert.equal(checkoutIdempotencyKey(requestStub({ headers: { 'idempotency-key': 'checkout:abc-123456789' } })), 'checkout:abc-123456789');
  assert.throws(() => checkoutIdempotencyKey(requestStub({ headers: { 'idempotency-key': 'short' } })), /Invalid checkout idempotency key/);
  assert.throws(() => checkoutIdempotencyKey(requestStub({ headers: { 'idempotency-key': 'bad key with spaces' } })), /Invalid checkout idempotency key/);
});

test('PhonePe state mapping handles success, failure, cancellation, timeout, and pending states', () => {
  assert.equal(statusFromPhonePeState('COMPLETED'), 'completed');
  assert.equal(statusFromPhonePeState('FAILED'), 'failed');
  assert.equal(statusFromPhonePeState('CANCELLED'), 'failed');
  assert.equal(statusFromPhonePeState('EXPIRED'), 'failed');
  assert.equal(statusFromPhonePeState('TIMED_OUT'), 'failed');
  assert.equal(statusFromPhonePeState('PENDING'), 'pending');
  assert.equal(statusFromPhonePeState('UNKNOWN'), '');
});

async function withMockedPhonePeStatus(states, callback) {
  const previousFetch = global.fetch;
  const previousEnv = {
    PHONEPE_CLIENT_ID: process.env.PHONEPE_CLIENT_ID,
    PHONEPE_CLIENT_SECRET: process.env.PHONEPE_CLIENT_SECRET,
    PHONEPE_CLIENT_VERSION: process.env.PHONEPE_CLIENT_VERSION,
    PHONEPE_ENV: process.env.PHONEPE_ENV,
    PHONEPE_AUTH_URL: process.env.PHONEPE_AUTH_URL,
    PHONEPE_BASE_URL: process.env.PHONEPE_BASE_URL
  };
  const queue = [...states];
  const calls = [];
  process.env.PHONEPE_CLIENT_ID = 'client';
  process.env.PHONEPE_CLIENT_SECRET = 'secret';
  process.env.PHONEPE_CLIENT_VERSION = '1';
  process.env.PHONEPE_ENV = 'sandbox';
  process.env.PHONEPE_AUTH_URL = 'https://phonepe.test/oauth/token';
  process.env.PHONEPE_BASE_URL = 'https://phonepe.test/apis/pg';
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/oauth/token')) {
      return new Response(JSON.stringify({
        access_token: 'token',
        token_type: 'O-Bearer',
        expires_at: Math.floor(Date.now() / 1000) + 300
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const state = queue.shift() || states.at(-1) || 'PENDING';
    return new Response(JSON.stringify({ state, orderId: 'OMO_TEST' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    await callback({ calls });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withMockedModels(callback) {
  const original = {
    tokenFindOneAndUpdate: TokenOrder.findOneAndUpdate,
    tokenFindById: TokenOrder.findById,
    userFindById: User.findById,
    userFindByIdAndUpdate: User.findByIdAndUpdate
  };
  const calls = { credits: 0, saves: 0, findById: 0 };
  TokenOrder.findOneAndUpdate = async (_filter, update) => ({ _id: 'order1', ...update.$set });
  TokenOrder.findById = async () => ({ _id: 'order1', status: 'completed', creditedAt: new Date() });
  User.findById = async () => {
    calls.findById += 1;
    return { _id: 'user1', tokens: 10 };
  };
  User.findByIdAndUpdate = async (_id, update) => {
    calls.credits += Number(update.$inc?.tokens || 0);
    return { _id: 'user1', tokens: calls.credits };
  };
  try {
    await callback(calls);
  } finally {
    TokenOrder.findOneAndUpdate = original.tokenFindOneAndUpdate;
    TokenOrder.findById = original.tokenFindById;
    User.findById = original.userFindById;
    User.findByIdAndUpdate = original.userFindByIdAndUpdate;
  }
}

function mockOrder(overrides = {}) {
  return {
    _id: 'order1',
    user: 'user1',
    merchantOrderId: 'FL_TEST',
    planId: TOP_UP_PLANS[0].id,
    orderType: 'topup',
    tokens: 7,
    status: 'pending',
    creditedAt: null,
    providerState: 'PENDING',
    providerResponse: null,
    async save() {
      this.saved = true;
    },
    ...overrides
  };
}

test('mocked PhonePe success grants credits exactly once and duplicate refresh does not add again', async () => {
  await withMockedModels(async (modelCalls) => {
    await withMockedPhonePeStatus(['COMPLETED'], async ({ calls }) => {
      const order = mockOrder();
      const result = await reconcileOrder(order);
      assert.equal(result.order.status, 'completed');
      assert.equal(modelCalls.credits, 7);
      assert.ok(calls.some((url) => url.includes('/checkout/v2/order/FL_TEST/status')));

      const duplicate = await reconcileOrder(mockOrder({ creditedAt: new Date(), tokens: 7 }));
      assert.equal(duplicate.user.tokens, 10);
      assert.equal(modelCalls.credits, 7);
    });
  });
});

test('mocked PhonePe failure, cancellation, and timeout do not credit tokens', async () => {
  await withMockedModels(async (modelCalls) => {
    for (const state of ['FAILED', 'CANCELLED', 'TIMED_OUT']) {
      await withMockedPhonePeStatus([state], async () => {
        const order = mockOrder();
        const result = await reconcileOrder(order);
        assert.equal(result.order.status, 'failed');
        assert.equal(result.order.providerState, state);
        assert.equal(result.order.saved, true);
      });
    }
    assert.equal(modelCalls.credits, 0);
  });
});

test('mocked PhonePe pending and delayed success keep backend status authoritative', async () => {
  await withMockedModels(async (modelCalls) => {
    await withMockedPhonePeStatus(['PENDING'], async () => {
      const order = mockOrder();
      const result = await reconcileOrder(order);
      assert.equal(result.order.status, 'pending');
      assert.equal(modelCalls.credits, 0);
    });

    await withMockedPhonePeStatus(['COMPLETED'], async () => {
      const order = mockOrder();
      const result = await reconcileOrder(order);
      assert.equal(result.order.status, 'completed');
      assert.equal(modelCalls.credits, 7);
    });
  });
});
