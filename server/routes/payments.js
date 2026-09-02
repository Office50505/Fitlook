import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import ClosetOutfit from '../models/ClosetOutfit.js';
import CustomTryOn from '../models/CustomTryOn.js';
import TokenOrder from '../models/TokenOrder.js';
import TryOn from '../models/TryOn.js';
import User from '../models/User.js';
import { requireUser } from './auth.js';
import { createRateLimiter, rateLimitKeys } from '../utils/rateLimit.js';
import {
  PAYMENT_PLANS,
  SUBSCRIPTION_PLAN,
  TOP_UP_PLANS,
  planById
} from '../../shared/pricing.js';
import { phonePeEnabled } from '../utils/envValidation.js';
import { isProductionEnv, validateConfiguredHttpsUrl } from '../utils/urlValidation.js';

const router = express.Router();
const paymentCreateLimiter = createRateLimiter({
  name: 'payments:create',
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: rateLimitKeys.user,
  message: 'Too many checkout attempts. Please wait a few minutes before trying again.'
});
const paymentStatusLimiter = createRateLimiter({
  name: 'payments:status',
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: rateLimitKeys.user,
  message: 'Payment status checks are temporarily limited. Please try again shortly.'
});

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
  const configured = process.env.CLIENT_ORIGIN || (!isProductionEnv() ? req.get('origin') || `${req.protocol}://${req.get('host')}` : '');
  return validateConfiguredHttpsUrl(configured, {
    name: 'CLIENT_ORIGIN',
    env: process.env,
    requireHttpsInProduction: true
  }).origin;
}

function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    orderType: plan.orderType,
    amount: plan.amount,
    dueTodayAmount: plan.dueTodayAmount || plan.amount,
    currency: plan.currency,
    tokens: plan.tokens,
    billing: plan.billing,
    cancellation: plan.cancellation || '',
    mandate: plan.mandate || null
  };
}

function checkoutMessage(plan) {
  if (plan.orderType === 'topup') return `Lookmefy ${plan.tokens} token top-up`;
  return `Set up ${plan.currency} ${(Number(plan.mandate?.recurringAmount || 0) / 100).toLocaleString('en-IN')}/month mandate`;
}

function configuredRedirectUrl(req, merchantOrderId, planId) {
  const approvedOrigin = clientOrigin(req);
  const base = process.env.PHONEPE_REDIRECT_URL || `${approvedOrigin}/tokens`;
  const url = validateConfiguredHttpsUrl(base, { name: 'PHONEPE_REDIRECT_URL', env: process.env });
  if (isProductionEnv() && url.origin !== approvedOrigin) {
    throw new Error('PHONEPE_REDIRECT_URL must use the approved CLIENT_ORIGIN in production');
  }
  url.searchParams.set('merchantOrderId', merchantOrderId);
  url.searchParams.set('plan', planId);
  return url.toString();
}

function addMonths(date, count) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + count);
  return next;
}

function requirePhonePeConfig() {
  if (!phonePeEnabled()) {
    const error = new Error('PhonePe payments are temporarily unavailable');
    error.statusCode = 503;
    throw error;
  }
  const missing = ['PHONEPE_CLIENT_ID', 'PHONEPE_CLIENT_SECRET', 'PHONEPE_CLIENT_VERSION']
    .filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`${missing.join(', ')} missing on the server`);
    error.statusCode = 503;
    throw error;
  }
}

function requirePhonePeCallbackConfig() {
  if (!phonePeEnabled()) {
    const error = new Error('PhonePe payments are temporarily unavailable');
    error.statusCode = 503;
    throw error;
  }
  const missing = ['PHONEPE_CALLBACK_USERNAME', 'PHONEPE_CALLBACK_PASSWORD']
    .filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`${missing.join(', ')} missing on the server`);
    error.statusCode = 503;
    throw error;
  }
}

function safeCompareHex(left, right) {
  const a = Buffer.from(String(left || '').trim().toLowerCase(), 'hex');
  const b = Buffer.from(String(right || '').trim().toLowerCase(), 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function calculatePhonePeCallbackAuthorization(username, password) {
  return createHash('sha256').update(`${username}:${password}`).digest('hex');
}

function validatePhonePeCallbackAuth(authorization, env = process.env) {
  const username = String(env.PHONEPE_CALLBACK_USERNAME || '');
  const password = String(env.PHONEPE_CALLBACK_PASSWORD || '');
  if (!username || !password) return false;
  return safeCompareHex(authorization, calculatePhonePeCallbackAuthorization(username, password));
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

function amountForPlan(plan) {
  return Number(plan.dueTodayAmount || plan.amount);
}

function recurringAmountForPlan(plan) {
  return Number(plan.mandate?.recurringAmount || 0) || null;
}

function billingFrequencyForPlan(plan) {
  return plan.mandate?.frequency || plan.billing || '';
}

function statusFromPhonePeState(state) {
  const normalized = String(state || '').toUpperCase();
  if (normalized === 'COMPLETED') return 'completed';
  if (['FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'TIMEOUT', 'TIMED_OUT'].includes(normalized)) return 'failed';
  if (normalized === 'PENDING') return 'pending';
  return '';
}

function createMerchantOrderId(userId) {
  const userPart = userId.toString().slice(-8);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FL_${Date.now()}_${userPart}_${random}`.slice(0, 63);
}

async function createPhonePePayment({ req, user, plan = SUBSCRIPTION_PLAN }) {
  requirePhonePeConfig();
  const idempotencyKey = checkoutIdempotencyKey(req);
  if (idempotencyKey) {
    const existingOrder = await TokenOrder.findOne({ user: user._id, idempotencyKey });
    if (existingOrder) {
      if (existingOrder.status === 'failed') {
        const error = new Error('Previous checkout attempt failed. Please start checkout again.');
        error.statusCode = 409;
        throw error;
      }
      return existingOrder;
    }
  }

  const merchantOrderId = createMerchantOrderId(user._id);
  const redirectUrl = configuredRedirectUrl(req, merchantOrderId, plan.id);
  const orderPayload = {
    user: user._id,
    merchantOrderId,
    planId: plan.id,
    planName: plan.name,
    orderType: plan.orderType,
    amount: amountForPlan(plan),
    dueTodayAmount: amountForPlan(plan),
    recurringAmount: recurringAmountForPlan(plan),
    billingFrequency: billingFrequencyForPlan(plan),
    currency: plan.currency,
    tokens: plan.tokens,
    redirectUrl,
    idempotencyKey
  };
  let order;
  try {
    order = await TokenOrder.create(orderPayload);
  } catch (error) {
    if (error.code === 11000 && idempotencyKey) {
      const existingOrder = await TokenOrder.findOne({ user: user._id, idempotencyKey });
      if (existingOrder) {
        if (existingOrder.status === 'failed') {
          const conflict = new Error('Previous checkout attempt failed. Please start checkout again.');
          conflict.statusCode = 409;
          throw conflict;
        }
        return existingOrder;
      }
    }
    throw error;
  }

  try {
    const payload = {
      merchantOrderId,
      amount: amountForPlan(plan),
      expireAfter: Number(process.env.PHONEPE_ORDER_EXPIRE_SECONDS || 1200),
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: checkoutMessage(plan),
        merchantUrls: { redirectUrl }
      },
      metaInfo: {
        udf1: user._id.toString(),
        udf2: plan.id,
        udf3: String(plan.tokens),
        udf4: 'Lookmefy',
        udf5: plan.orderType
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
  const isSubscription = order.orderType === 'subscription' || order.planId === SUBSCRIPTION_PLAN.id;
  const currentPeriodEnd = isSubscription ? addMonths(now, 1) : null;
  const orderSet = {
    status: 'completed',
    providerState: 'COMPLETED',
    providerResponse,
    creditedAt: now
  };
  if (isSubscription) {
    orderSet.currentPeriodStart = now;
    orderSet.currentPeriodEnd = currentPeriodEnd;
  }
  const creditedOrder = await TokenOrder.findOneAndUpdate(
    { _id: order._id, creditedAt: null },
    { $set: orderSet },
    { new: true }
  );
  if (!creditedOrder) return User.findById(order.user);

  const userUpdate = {
    $inc: { tokens: order.tokens }
  };
  if (isSubscription) {
    userUpdate.$set = {
      subscription: {
        planId: order.planId,
        status: 'active',
        tokensPerMonth: order.tokens,
        currentPeriodStart: now,
        currentPeriodEnd,
        lastOrderId: order.merchantOrderId
      }
    };
  }

  return User.findOneAndUpdate(
    { _id: order.user, accountStatus: { $ne: 'deleted' } },
    userUpdate,
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
  order.status = statusFromPhonePeState(state) || order.status;
  await order.save();
  return { order, user: await User.findById(order.user) };
}

function orderIdFromCallback(req) {
  const payload = req.callbackPayload || req.body || {};
  const candidates = [
    req.query?.merchantOrderId,
    payload?.merchantOrderId,
    payload?.merchantOrderID,
    payload?.orderId,
    payload?.eventPayload?.merchantOrderId,
    payload?.eventPayload?.orderId,
    payload?.payload?.merchantOrderId,
    payload?.payload?.orderId,
    payload?.data?.merchantOrderId,
    payload?.data?.orderId
  ];
  return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function checkoutIdempotencyKey(req) {
  const value = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (!value) return '';
  if (!/^[A-Za-z0-9._:-]{12,120}$/.test(value)) {
    const error = new Error('Invalid checkout idempotency key');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function callbackAuthorizationHeader(req) {
  return String(req.get('authorization') || req.get('x-phonepe-authorization') || '').trim();
}

async function findOrderFromCallback(req) {
  const id = orderIdFromCallback(req);
  if (!id) return null;
  return TokenOrder.findOne({
    $or: [
      { merchantOrderId: id },
      { phonePeOrderId: id }
    ]
  });
}

router.get('/plans', (_req, res) => {
  res.json({
    plans: PAYMENT_PLANS.map(publicPlan),
    subscription: publicPlan(SUBSCRIPTION_PLAN),
    topUps: TOP_UP_PLANS.map(publicPlan),
    costs: {
      imageTokens: Number(process.env.TRYON_TOKEN_COST || 1),
      videoTokens: Number(process.env.TRYON_VIDEO_TOKEN_COST || 3)
    }
  });
});

router.get('/credits/history', requireUser, async (req, res) => {
  const userId = req.user._id;
  const [orders, tryOns, customTryOns, closetOutfits] = await Promise.all([
    TokenOrder.find({ user: userId, status: 'completed' }).sort({ creditedAt: -1, createdAt: -1 }).limit(30).lean(),
    TryOn.find({ user: userId }).sort({ createdAt: -1 }).limit(40).populate('product', 'name').lean(),
    CustomTryOn.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean(),
    ClosetOutfit.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean()
  ]);

  const purchaseItems = orders.map((order) => ({
    id: `order-${order._id}`,
    type: 'purchase',
    title: order.orderType === 'topup' ? (order.planName || 'Token top-up') : (order.planName || 'Credit purchase'),
    detail: order.amount ? `${order.currency || 'INR'} ${(Number(order.amount || 0) / 100).toLocaleString('en-IN')}` : 'Payment verified',
    credits: Number(order.tokens || 0),
    date: order.creditedAt || order.createdAt,
    status: order.status
  }));

  const productTryOnItems = tryOns.flatMap((tryOn) => {
    const items = [];
    const tokenCost = Number(tryOn.tokenCost || 0);
    if (tokenCost > 0) {
      items.push({
        id: `tryon-${tryOn._id}`,
        type: 'usage',
        title: 'AI try-on image',
        detail: tryOn.product?.name || 'Product preview',
        credits: -tokenCost,
        date: tryOn.createdAt,
        status: 'used'
      });
    }
    const videoCost = Number(tryOn.video?.tokenCost || 0);
    if (videoCost > 0 && tryOn.video?.generatedAt) {
      items.push({
        id: `tryon-video-${tryOn._id}`,
        type: 'usage',
        title: 'Generated video',
        detail: tryOn.product?.name || 'Product video preview',
        credits: -videoCost,
        date: tryOn.video.generatedAt,
        status: 'used'
      });
    }
    return items;
  });

  const customTryOnItems = customTryOns
    .filter((tryOn) => Number(tryOn.tokenCost || 0) > 0)
    .map((tryOn) => ({
      id: `custom-${tryOn._id}`,
      type: 'usage',
      title: 'Custom try-on',
      detail: 'Uploaded garment render',
      credits: -Number(tryOn.tokenCost || 0),
      date: tryOn.createdAt,
      status: 'used'
    }));

  const closetItems = closetOutfits
    .filter((outfit) => Number(outfit.tokenCost || 0) > 0)
    .map((outfit) => ({
      id: `closet-${outfit._id}`,
      type: 'usage',
      title: 'Wardrobe look',
      detail: outfit.title || 'Generated outfit',
      credits: -Number(outfit.tokenCost || 0),
      date: outfit.createdAt,
      status: 'used'
    }));

  const items = [...purchaseItems, ...productTryOnItems, ...customTryOnItems, ...closetItems]
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 50);

  const totalPurchased = purchaseItems.reduce((sum, item) => sum + Math.max(0, Number(item.credits || 0)), 0);
  const totalUsed = [...productTryOnItems, ...customTryOnItems, ...closetItems]
    .reduce((sum, item) => sum + Math.abs(Math.min(0, Number(item.credits || 0))), 0);

  res.json({
    balance: Number(req.user.tokens || 0),
    totalPurchased,
    totalUsed,
    items
  });
});

router.post('/checkout', requireUser, paymentCreateLimiter, async (req, res) => {
  try {
    const requestedPlanId = String(req.body?.planId || '').trim();
    const plan = requestedPlanId ? planById(requestedPlanId) : SUBSCRIPTION_PLAN;
    if (!plan) return res.status(400).json({ message: 'Selected credit plan is not available.' });
    const order = await createPhonePePayment({ req, user: req.user, plan });
    res.status(201).json({ order: order.toClient(), redirectUrl: order.redirectUrl });
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: readablePhonePeError(error, 'Could not start PhonePe checkout') });
  }
});

router.post('/phonepe/subscription', requireUser, paymentCreateLimiter, async (req, res) => {
  try {
    const order = await createPhonePePayment({ req, user: req.user, plan: SUBSCRIPTION_PLAN });
    res.status(201).json({ order: order.toClient(), redirectUrl: order.redirectUrl });
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: readablePhonePeError(error, 'Could not start PhonePe checkout') });
  }
});

router.get('/orders/:merchantOrderId/status', requireUser, paymentStatusLimiter, async (req, res) => {
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
    res.status(error.statusCode || 400).json({ message: readablePhonePeError(error, 'Could not verify PhonePe payment') });
  }
});

router.post('/phonepe/callback', async (req, res) => {
  try {
    requirePhonePeCallbackConfig();
    if (!validatePhonePeCallbackAuth(callbackAuthorizationHeader(req))) {
      return res.status(401).json({ ok: false });
    }
  } catch (error) {
    return res.status(503).json({ ok: false, message: readablePhonePeError(error, 'PhonePe callback verification is not configured') });
  }

  const order = await findOrderFromCallback(req);
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

export {
  amountForPlan,
  billingFrequencyForPlan,
  calculatePhonePeCallbackAuthorization,
  callbackAuthorizationHeader,
  checkoutIdempotencyKey,
  configuredRedirectUrl,
  createMerchantOrderId,
  findOrderFromCallback,
  grantPaidTokens,
  orderIdFromCallback,
  phonePeFetch,
  reconcileOrder,
  readablePhonePeError,
  recurringAmountForPlan,
  requirePhonePeCallbackConfig,
  requirePhonePeConfig,
  statusFromPhonePeState,
  validatePhonePeCallbackAuth
};

export default router;
