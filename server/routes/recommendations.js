import express from 'express';
import mongoose from 'mongoose';
import Product, { productToClient } from '../models/Product.js';
import UserEvent from '../models/UserEvent.js';
import UserPreference from '../models/UserPreference.js';
import { requireUser } from './auth.js';
import { createHybridCache } from '../utils/cache.js';

const router = express.Router();
const recommendationCacheTtlMs = Number(process.env.RECOMMENDATION_READ_CACHE_TTL_MS || 30 * 1000);
const productPoolCache = createHybridCache('recommendations:product-pool', { ttlMs: recommendationCacheTtlMs, maxItems: 20 });
const similarProductsCache = createHybridCache('recommendations:similar', { ttlMs: recommendationCacheTtlMs, maxItems: 300 });

async function clearRecommendationCaches() {
  await Promise.all([
    productPoolCache.clear(),
    similarProductsCache.clear()
  ]);
}

const EVENT_WEIGHTS = {
  search: 1,
  filter: 1,
  product_view: 2,
  product_click: 2,
  style_bot_query: 2,
  custom_tryon: 2,
  try_on: 5,
  shop_click: 8
};

function catalogFilter(extra = {}) {
  const botAmazonRecord = { badge: 'Amazon', $or: [{ sourceUrl: /amazon\.[a-z.]+\/dp\//i }, { affiliateLink: /amazon\.[a-z.]+\/dp\//i }] };
  return { isActive: true, $nor: [botAmazonRecord], ...extra };
}

function normalizeKey(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function queryTerms(value = '') {
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9]{3,}/g) || [])].slice(0, 8);
}

function preferenceValue(map, key) {
  if (!map || !key) return 0;
  return map.get?.(key) || map[key] || 0;
}

function eventWeight(type) {
  return EVENT_WEIGHTS[type] || 1;
}

function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(500).json({ message: 'ADMIN_KEY is missing on the server' });
  if (req.headers['x-admin-key'] !== adminKey) return res.status(401).json({ message: 'Invalid admin key' });
  next();
}

function productPreferenceIncrements(product, weight) {
  const increments = {};
  const add = (bucket, value, scale = 1) => {
    const key = normalizeKey(value);
    if (!key) return;
    increments[`${bucket}.${key}`] = (increments[`${bucket}.${key}`] || 0) + weight * scale;
  };

  add('categories', product?.category, 1);
  add('brands', product?.brand, 0.75);
  add('genders', product?.gender, 0.8);
  (product?.tags || []).slice(0, 10).forEach((tag) => add('tags', tag, 0.7));
  if (Number.isFinite(Number(product?.price))) {
    increments.priceTotal = Number(product.price) * weight;
    increments.priceCount = weight;
  }
  return increments;
}

function queryPreferenceIncrements(query, weight) {
  const increments = {};
  queryTerms(query).forEach((term) => {
    const key = normalizeKey(term);
    if (key) increments[`tags.${key}`] = (increments[`tags.${key}`] || 0) + weight;
  });
  return increments;
}

async function updatePreference({ userId, type, product, query, metadata }) {
  const weight = eventWeight(type);
  const preferenceSource = product || metadata?.product || metadata;
  const increments = {
    ...queryPreferenceIncrements(query, weight),
    ...productPreferenceIncrements(preferenceSource, weight)
  };
  if (Object.keys(increments).length === 0) return null;

  return UserPreference.findOneAndUpdate(
    { user: userId },
    { $inc: increments, $setOnInsert: { user: userId } },
    { upsert: true, new: true }
  );
}

function scoreProduct(product, preference) {
  if (!preference) return 0;
  const categoryScore = preferenceValue(preference.categories, normalizeKey(product.category)) * 4;
  const brandScore = preferenceValue(preference.brands, normalizeKey(product.brand)) * 2;
  const genderScore = preferenceValue(preference.genders, normalizeKey(product.gender)) * 3;
  const tagScore = (product.tags || []).slice(0, 12).reduce((sum, tag) => sum + preferenceValue(preference.tags, normalizeKey(tag)), 0) * 2.5;
  const averagePrice = preference.priceCount ? preference.priceTotal / preference.priceCount : 0;
  const price = Number(product.price);
  const priceFit = averagePrice && Number.isFinite(price) ? Math.max(0, 2 - Math.abs(price - averagePrice) / Math.max(averagePrice, 1)) : 0;
  const recencyBoost = product.isNewArrival ? 0.8 : 0;
  const featuredBoost = product.isFeatured ? 0.8 : 0;
  const ratingBoost = Number(product.rating || 0) / 5;
  return categoryScore + brandScore + genderScore + tagScore + priceFit + recencyBoost + featuredBoost + ratingBoost;
}

function similarScore(base, product) {
  const baseTags = new Set((base.tags || []).map(normalizeKey).filter(Boolean));
  const productTags = (product.tags || []).map(normalizeKey).filter(Boolean);
  const sharedTags = productTags.filter((tag) => baseTags.has(tag)).length;
  const basePrice = Number(base.price);
  const price = Number(product.price);
  const priceFit = Number.isFinite(basePrice) && Number.isFinite(price) ? Math.max(0, 2 - Math.abs(price - basePrice) / Math.max(basePrice, 1)) : 0;
  return (
    (normalizeKey(base.category) === normalizeKey(product.category) ? 6 : 0) +
    (normalizeKey(base.gender) === normalizeKey(product.gender) ? 3 : 0) +
    (normalizeKey(base.brand) === normalizeKey(product.brand) ? 2 : 0) +
    sharedTags * 2 +
    priceFit +
    (product.isNewArrival ? 0.5 : 0) +
    Number(product.rating || 0) / 5
  );
}

router.post('/events', requireUser, async (req, res) => {
  const type = String(req.body?.type || '').trim();
  if (!EVENT_WEIGHTS[type]) return res.status(400).json({ message: 'Unknown recommendation event type' });

  const productId = String(req.body?.productId || '').trim();
  const query = String(req.body?.query || '').trim();
  const product = mongoose.Types.ObjectId.isValid(productId)
    ? await Product.findOne({ _id: productId, isActive: true }).lean()
    : null;

  await UserEvent.create({
    user: req.user._id,
    type,
    product: product?._id,
    query,
    weight: eventWeight(type),
    metadata: req.body?.metadata || {}
  });
  await updatePreference({ userId: req.user._id, type, product, query, metadata: req.body?.metadata || {} });
  res.status(201).json({ ok: true });
});

router.get('/admin/stats', requireAdmin, async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [totalEvents, activeUsers, eventCounts, topProducts, preferences, recentEvents] = await Promise.all([
    UserEvent.countDocuments(),
    UserEvent.distinct('user', { createdAt: { $gte: since } }),
    UserEvent.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 }, weight: { $sum: '$weight' } } },
      { $sort: { count: -1 } }
    ]),
    UserEvent.aggregate([
      { $match: { product: { $exists: true, $ne: null } } },
      { $group: { _id: '$product', count: { $sum: 1 }, weight: { $sum: '$weight' } } },
      { $sort: { weight: -1, count: -1 } },
      { $limit: 8 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $project: { count: 1, weight: 1, name: '$product.name', brand: '$product.brand', category: '$product.category' } }
    ]),
    UserPreference.find({}).limit(500).lean(),
    UserEvent.find({}).sort({ createdAt: -1 }).limit(12).populate('product', 'name brand category').lean()
  ]);

  const rollup = (bucket) => {
    const totals = new Map();
    preferences.forEach((preference) => {
      const entries = preference[bucket] instanceof Map ? preference[bucket].entries() : Object.entries(preference[bucket] || {});
      for (const [key, value] of entries) totals.set(key, (totals.get(key) || 0) + Number(value || 0));
    });
    return [...totals.entries()]
      .map(([key, weight]) => ({ key, label: key.replace(/_/g, ' '), weight: Math.round(weight * 10) / 10 }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
  };

  const priceTotal = preferences.reduce((sum, preference) => sum + Number(preference.priceTotal || 0), 0);
  const priceCount = preferences.reduce((sum, preference) => sum + Number(preference.priceCount || 0), 0);

  res.json({
    totals: {
      events: totalEvents,
      activeUsers30d: activeUsers.length,
      preferenceProfiles: preferences.length,
      averagePreferredPrice: priceCount ? Math.round(priceTotal / priceCount) : 0
    },
    eventCounts: eventCounts.map((item) => ({ type: item._id, count: item.count, weight: Math.round(item.weight * 10) / 10 })),
    topProducts: topProducts.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      brand: item.brand,
      category: item.category,
      count: item.count,
      weight: Math.round(item.weight * 10) / 10
    })),
    topCategories: rollup('categories'),
    topBrands: rollup('brands'),
    topTags: rollup('tags'),
    topGenders: rollup('genders'),
    recentEvents: recentEvents.map((event) => ({
      id: event._id.toString(),
      type: event.type,
      query: event.query,
      weight: event.weight,
      product: event.product ? {
        name: event.product.name,
        brand: event.product.brand,
        category: event.product.category
      } : null,
      createdAt: event.createdAt
    }))
  });
});

router.get('/for-you', requireUser, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 8, 24);
  const preference = await UserPreference.findOne({ user: req.user._id }).lean();
  const products = await productPoolCache.remember(
    'for-you-catalog',
    () => Product.find(catalogFilter()).sort({ isFeatured: -1, createdAt: -1 }).limit(180).lean()
  );
  const ranked = products
    .map((product) => ({ product, score: scoreProduct(product, preference) }))
    .sort((a, b) => b.score - a.score || Number(b.product.rating || 0) - Number(a.product.rating || 0))
    .slice(0, limit)
    .map(({ product, score }) => ({ ...productToClient(product), recommendationScore: Math.round(score * 100) / 100 }));

  res.json({ products: ranked, personalized: Boolean(preference) });
});

router.get('/similar/:productId', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.productId)) return res.status(404).json({ message: 'Product not found' });
  const limit = Math.min(Number(req.query.limit) || 4, 12);
  const cacheKey = `${req.params.productId}:${limit}`;
  const cached = await similarProductsCache.get(cacheKey);
  if (cached) return res.json(cached);

  const base = await Product.findOne({ _id: req.params.productId, isActive: true }).lean();
  if (!base) return res.status(404).json({ message: 'Product not found' });
  const products = await Product.find(catalogFilter({ _id: { $ne: base._id } })).limit(160).lean();
  const ranked = products
    .map((product) => ({ product, score: similarScore(base, product) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ product, score }) => ({ ...productToClient(product), recommendationScore: Math.round(score * 100) / 100 }));
  const payload = { products: ranked };
  await similarProductsCache.set(cacheKey, payload);
  res.json(payload);
});

export default router;
export { clearRecommendationCaches };
