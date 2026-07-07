import express from 'express';
import TokenOrder from '../models/TokenOrder.js';
import User from '../models/User.js';
import { requireUser } from './auth.js';

const router = express.Router();

const MONTHLY_PLAN = {
  id: 'monthly_100_tokens',
  name: 'Monthly FitLook Tokens',
  amount: 100000,
  currency: 'INR',
  tokens: 100
};

let cachedAuth = null;

function phonePeEnv() {
  return String(process.env.PHONEPE_ENV || process.env.NODE_ENV || 'production').toLowerCase();
}

function isSandbox() {
  return ['sandbox', 'uat', 'preprod', 'development', 'dev', 'test'].includes(phonePeEnv());
}

function phonePePgBaseUrl() {
  const prod = 'https://api.phonepe.com/apis/pg';
  const preprod = 'https://api-preprod.phonepe.com/apis/pg-sandbox';
  if (process.env.PHONEPE_BASE_URL) {
    const given = process.env.PHONEPE_BASE_URL.replace(/\/+$/, '');
    if (isSandbox() && given === prod) {
      console.warn('[phonepe] PHONEPE_BASE_URL points to production while PHONEPE_ENV is sandbox — using preprod URL instead');
      return preprod;
    }
    return given;
  }
  return isSandbox() ? preprod : prod;
}

function phonePeAuthUrl() {
  const prod = 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';
  const preprod = 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';
  if (process.env.PHONEPE_AUTH_URL) {
    const given = process.env.PHONEPE_AUTH_URL;
    if (isSandbox() && given === prod) {
      console.warn('[phonepe] PHONEPE_AUTH_URL points to production while PHONEPE_ENV is sandbox — using preprod URL instead');
      return preprod;
    }
    return given;
  }
  return isSandbox() ? preprod : prod;
}

function startShortPolling(merchantOrderId) {
  const attempts = Number(process.env.PHONEPE_SHORT_POLL_ATTEMPTS || 6);
  const intervalMs = Number(process.env.PHONEPE_SHORT_POLL_MS || 5000);
  let tries = 0;
  const id = setInterval(async () => {
    tries += 1;
    try {
      const order = await TokenOrder.findOne({ merchantOrderId });
      if (!order) {
        if (tries >= attempts) clearInterval(id);
        return;
      }
      const result = await reconcileOrder(order);
      const state = String(result.order?.providerState || '').toUpperCase();
      if (state === 'COMPLETED' || result.order?.creditedAt) {
        clearInterval(id);
        return;
      }
      if (tries >= attempts) clearInterval(id);
    } catch (err) {
      console.error('[phonepe:shortpoll]', merchantOrderId, readablePhonePeError(err));
      if (tries >= attempts) clearInterval(id);
    }
  }, intervalMs);
}

function clientOrigin(req) {
  return process.env.CLIENT_ORIGIN || req.get('origin') || `${req.protocol}://${req.get('host')}`;
}

function configuredRedirectUrl(req, merchantOrderId) {
  const base = process.env.PHONEPE_REDIRECT_URL || `${clientOrigin(req)}/tokens`;
  const url = new URL(base, clientOrigin(req));
  url.searchParams.set('merchantOrderId', merchantOrderId);
  url.searchParams.set('plan', MONTHLY_PLAN.id);
  return url.toString();
}

function addMonths(date, count) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + count);
  return next;
}

function requirePhonePeConfig() {
  const missing = ['PHONEPE_CLIENT_ID', 'PHONEPE_CLIENT_SECRET', 'PHONEPE_CLIENT_VERSION']
    .filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`${missing.join(', ')} missing on the server`);
}

function readablePhonePeError(value, fallback = 'PhonePe request failed') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === 'object') return value.message || value.code || value.error || fallback;
  return String(value);
}

async function phonePeAuthToken() {
  requirePhonePeConfig();
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedAuth?.accessToken && cachedAuth.expiresAt - 60 > nowSeconds) return cachedAuth;

  const body = new URLSearchParams();
  body.set('client_id', process.env.PHONEPE_CLIENT_ID);
  body.set('client_version', process.env.PHONEPE_CLIENT_VERSION || '1');
  body.set('client_secret', process.env.PHONEPE_CLIENT_SECRET);
  body.set('grant_type', 'client_credentials');

  const response = await fetch(phonePeAuthUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await response.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { raw: text };
  }
  if (!response.ok || !data.access_token) {
    console.error('[phonepe:auth] failed', { status: response.status, body: data });
    throw new Error(readablePhonePeError(data, 'Could not authorize PhonePe'));
  }

  cachedAuth = {
    accessToken: data.access_token,
    tokenType: data.token_type || 'O-Bearer',
    expiresAt: Number(data.expires_at || nowSeconds + 300)
  };
  return cachedAuth;
}

async function phonePeFetch(path, options = {}) {
  const auth = await phonePeAuthToken();
  const response = await fetch(`${phonePePgBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${auth.tokenType} ${auth.accessToken}`,
      ...options.headers
    }
  });
  const text = await response.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { raw: text };
  }
  if (!response.ok) {
    console.error('[phonepe:fetch] failed', { path, status: response.status, body: data });
    throw new Error(readablePhonePeError(data, 'PhonePe request failed'));
  }
  return data;
}

function createMerchantOrderId(userId) {
  const userPart = userId.toString().slice(-8);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FL_${Date.now()}_${userPart}_${random}`.slice(0, 63);
}

async function createPhonePePayment({ req, user }) {
  const merchantOrderId = createMerchantOrderId(user._id);
  const redirectUrl = configuredRedirectUrl(req, merchantOrderId);
  const order = await TokenOrder.create({
    user: user._id,
    merchantOrderId,
    planId: MONTHLY_PLAN.id,
    planName: MONTHLY_PLAN.name,
    amount: MONTHLY_PLAN.amount,
    currency: MONTHLY_PLAN.currency,
    tokens: MONTHLY_PLAN.tokens,
    redirectUrl
  });

  try {
    const payload = {
      merchantOrderId,
      amount: MONTHLY_PLAN.amount,
      expireAfter: Number(process.env.PHONEPE_ORDER_EXPIRE_SECONDS || 1200),
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: 'FitLook monthly token subscription',
        merchantUrls: { redirectUrl }
      },
      metaInfo: {
        udf1: user._id.toString(),
        udf2: MONTHLY_PLAN.id,
        udf3: String(MONTHLY_PLAN.tokens),
        udf4: 'FitLook',
        udf5: 'monthly'
      }
    };

    const data = await phonePeFetch('/checkout/v2/pay', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    order.status = 'pending';
    order.providerState = data.state || 'PENDING';
    order.phonePeOrderId = data.orderId;
    order.redirectUrl = data.redirectUrl || redirectUrl;
    order.providerResponse = data;
    await order.save();
    // Start a short-polling fallback in case callbacks are delayed/missed
    try {
      startShortPolling(merchantOrderId);
    } catch (e) {
      console.error('[phonepe] failed to start short polling', readablePhonePeError(e));
    }
    return order;
  } catch (error) {
    order.status = 'failed';
    order.providerState = 'CREATE_FAILED';
    order.providerResponse = { message: readablePhonePeError(error) };
    await order.save();
    throw error;
  }
}

async function grantPaidTokens(order, providerResponse) {
  if (order.creditedAt) return User.findById(order.user);

  const now = new Date();
  const currentPeriodEnd = addMonths(now, 1);
  const creditedOrder = await TokenOrder.findOneAndUpdate(
    { _id: order._id, creditedAt: null },
    {
      $set: {
        status: 'completed',
        providerState: 'COMPLETED',
        providerResponse,
        creditedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd
      }
    },
    { new: true }
  );
  if (!creditedOrder) return User.findById(order.user);

  return User.findByIdAndUpdate(
    order.user,
    {
      $inc: { tokens: order.tokens },
      $set: {
        subscription: {
          planId: order.planId,
          status: 'active',
          tokensPerMonth: order.tokens,
          currentPeriodStart: now,
          currentPeriodEnd,
          lastOrderId: order.merchantOrderId
        }
      }
    },
    { new: true }
  );
}

async function reconcileOrder(order) {
  if (!order) return { order: null, user: null };
  if (order.creditedAt) return { order, user: await User.findById(order.user) };

  const status = await phonePeFetch(`/checkout/v2/order/${encodeURIComponent(order.merchantOrderId)}/status?details=true&errorContext=true`);
  const state = String(status.state || '').toUpperCase();

  if (state === 'COMPLETED') {
    const user = await grantPaidTokens(order, status);
    const completedOrder = await TokenOrder.findById(order._id);
    return { order: completedOrder, user };
  }

  order.providerState = state || order.providerState;
  order.providerResponse = status;
  if (state === 'FAILED') order.status = 'failed';
  else if (state === 'PENDING') order.status = 'pending';
  await order.save();
  return { order, user: await User.findById(order.user) };
}

function orderIdFromCallback(req) {
  const candidates = [
    req.query?.merchantOrderId,
    req.body?.merchantOrderId,
    req.body?.merchantOrderID,
    req.body?.eventPayload?.merchantOrderId,
    req.body?.payload?.merchantOrderId,
    req.body?.data?.merchantOrderId
  ];
  return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

router.get('/plans', (_req, res) => {
  res.json({ plans: [MONTHLY_PLAN] });
});

router.post('/phonepe/subscription', requireUser, async (req, res) => {
  try {
    const order = await createPhonePePayment({ req, user: req.user });
    res.status(201).json({ order: order.toClient(), redirectUrl: order.redirectUrl });
  } catch (error) {
    res.status(400).json({ message: readablePhonePeError(error, 'Could not start PhonePe checkout') });
  }
});

router.get('/orders/:merchantOrderId/status', requireUser, async (req, res) => {
  const order = await TokenOrder.findOne({
    merchantOrderId: req.params.merchantOrderId,
    user: req.user._id
  });
  if (!order) return res.status(404).json({ message: 'Token order not found' });

  try {
    const result = await reconcileOrder(order);
    res.json({
      order: result.order.toClient(),
      user: result.user?.toClient?.() || req.user.toClient()
    });
  } catch (error) {
    res.status(400).json({ message: readablePhonePeError(error, 'Could not verify PhonePe payment') });
  }
});

router.post('/phonepe/callback', async (req, res) => {
  const merchantOrderId = orderIdFromCallback(req);
  if (!merchantOrderId) return res.status(202).json({ ok: true });

  const order = await TokenOrder.findOne({ merchantOrderId });
  if (!order) return res.status(202).json({ ok: true });

  // Acknowledge quickly and reconcile asynchronously to keep callback latency low
  res.status(202).json({ ok: true });
  setImmediate(async () => {
    try {
      await reconcileOrder(order);
    } catch (error) {
      console.error('[phonepe:callback:bg]', readablePhonePeError(error));
    }
  });
});

export default router;
