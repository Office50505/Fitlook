import express from 'express';
import mongoose from 'mongoose';
import Product, { productToClient } from '../models/Product.js';
import UserEvent from '../models/UserEvent.js';
import UserPreference from '../models/UserPreference.js';
import { requireUser } from './auth.js';
import { createHybridCache } from '../utils/cache.js';
import { createRateLimiter, rateLimitKeys } from '../utils/rateLimit.js';
import { requireAdmin } from '../utils/adminAccess.js';

const router = express.Router();
const recommendationCacheTtlMs = Number(process.env.RECOMMENDATION_READ_CACHE_TTL_MS || 5 * 60 * 1000);
const productPoolCache = createHybridCache('recommendations:product-pool', { ttlMs: recommendationCacheTtlMs, maxItems: 20 });
const similarProductsCache = createHybridCache('recommendations:similar', { ttlMs: recommendationCacheTtlMs, maxItems: 300 });
const recommendationEventLimiter = createRateLimiter({
  name: 'recommendations:events',
  windowMs: 5 * 60 * 1000,
  max: 120,
  keyGenerator: rateLimitKeys.user,
  message: 'Too many recommendation events. Please slow down and keep browsing.'
});
const recommendationReadLimiter = createRateLimiter({
  name: 'recommendations:read',
  windowMs: 5 * 60 * 1000,
  max: 300,
  keyGenerator: rateLimitKeys.userOrIp,
  message: 'Recommendations are temporarily limited. Please try again shortly.'
});

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_EVENT_WINDOW_DAYS = 90;
const RECENT_EVENT_HALF_LIFE_DAYS = 14;
const RECOMMENDATION_ALGORITHM_VERSION = 'hybrid-v2';
const DIVERSITY_CATEGORY_PENALTY = 0.9;
const DIVERSITY_BRAND_PENALTY = 0.55;
const recommendationCandidatePoolSize = Math.min(1000, Math.max(100, Math.floor(Number(process.env.RECOMMENDATION_CANDIDATE_POOL_SIZE) || 400)));

async function clearRecommendationCaches() {
  await Promise.all([
    productPoolCache.clear(),
    similarProductsCache.clear()
  ]);
}

const EVENT_WEIGHTS = {
  page_view: 0.1,
  search: 1,
  filter: 1.25,
  wishlist: 4,
  product_view: 1.5,
  product_click: 2.5,
  style_bot_query: 2,
  custom_tryon: 2,
  try_on: 6,
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

function normalizeGender(value = '') {
  const key = normalizeKey(value);
  if (['male', 'man', 'men', 'mens', 'men_s', 'boy', 'boys'].includes(key)) return 'male';
  if (['female', 'woman', 'women', 'womens', 'women_s', 'girl', 'girls'].includes(key)) return 'female';
  if (['unisex', 'all', 'any'].includes(key)) return 'unisex';
  return 'other';
}

function queryTerms(value = '') {
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9]{3,}/g) || [])].slice(0, 8);
}

function listValues(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === '' ? [] : [value];
}

function boundedLimit(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
}

function preferenceValue(map, key) {
  if (!map || !key) return 0;
  return map.get?.(key) || map[key] || 0;
}

function genderSignalValue(map, gender) {
  const normalized = normalizeGender(gender);
  const aliases = {
    male: ['male', 'man', 'men', 'mens', 'men_s', 'boy', 'boys'],
    female: ['female', 'woman', 'women', 'womens', 'women_s', 'girl', 'girls'],
    unisex: ['unisex', 'all', 'any'],
    other: ['other']
  };
  return aliases[normalized].reduce((sum, key) => sum + Number(preferenceValue(map, key) || 0), 0);
}

function eventWeight(type) {
  return EVENT_WEIGHTS[type] || 1;
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
  const gender = normalizeGender(product?.gender);
  add('genders', gender === 'other' ? product?.gender : gender, 0.8);
  listValues(product?.tags).slice(0, 10).forEach((tag) => add('tags', tag, 0.7));
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

function addProfileValue(map, value, weight) {
  const key = normalizeKey(value);
  if (!key || !Number.isFinite(weight) || weight <= 0) return false;
  map.set(key, (map.get(key) || 0) + weight);
  return true;
}

function productId(value) {
  const id = value?._id ?? value;
  if (!id) return '';
  return typeof id === 'string' ? id : id.toString?.() || '';
}

function createRecentProfile() {
  return {
    categories: new Map(),
    brands: new Map(),
    genders: new Map(),
    tags: new Map(),
    productExposure: new Map(),
    priceTotal: 0,
    priceCount: 0,
    signalCount: 0
  };
}

function buildRecentProfile(events = [], now = new Date()) {
  const profile = createRecentProfile();
  const nowMs = new Date(now).getTime();
  const exposureScales = { product_view: 0.8, product_click: 1, wishlist: 0.15, try_on: 0.1 };

  for (const event of events) {
    const createdAtMs = new Date(event.createdAt || now).getTime();
    const ageDays = Math.max(0, (nowMs - createdAtMs) / DAY_MS);
    if (!Number.isFinite(createdAtMs) || ageDays > RECENT_EVENT_WINDOW_DAYS) continue;

    const weight = eventWeight(event.type) * Math.pow(0.5, ageDays / RECENT_EVENT_HALF_LIFE_DAYS);
    const source = event.product || event.metadata?.product || event.metadata || {};
    let contributed = false;
    contributed = addProfileValue(profile.categories, source.category, weight) || contributed;
    contributed = addProfileValue(profile.brands, source.brand, weight * 0.75) || contributed;
    const gender = normalizeGender(source.gender);
    contributed = addProfileValue(profile.genders, gender === 'other' ? source.gender : gender, weight * 0.8) || contributed;
    for (const tag of listValues(source.tags).slice(0, 10)) {
      contributed = addProfileValue(profile.tags, tag, weight * 0.7) || contributed;
    }
    for (const term of queryTerms(event.query)) {
      contributed = addProfileValue(profile.tags, term, weight) || contributed;
    }

    const price = Number(source.price);
    if (Number.isFinite(price) && price >= 0) {
      profile.priceTotal += price * weight;
      profile.priceCount += weight;
      contributed = true;
    }

    const id = productId(event.product);
    const exposureScale = exposureScales[event.type] || 0;
    if (id && exposureScale) {
      profile.productExposure.set(id, (profile.productExposure.get(id) || 0) + weight * exposureScale);
    }
    if (contributed) profile.signalCount += 1;
  }

  return profile;
}

function boundedSignal(value) {
  return Math.log1p(Math.max(0, Number(value) || 0));
}

function ratingQuality(product) {
  const rating = Math.min(5, Math.max(0, Number(product.rating) || 0));
  const ratingCount = Math.max(0, Number(product.ratingCount) || 0);
  const priorRating = 4.1;
  const priorCount = 20;
  const bayesianRating = ((rating * ratingCount) + (priorRating * priorCount)) / (ratingCount + priorCount);
  return Math.max(0, Math.min(1.6, ((bayesianRating - 3) / 2) * 1.6));
}

function freshnessQuality(product, now) {
  const createdAtMs = new Date(product.createdAt || 0).getTime();
  const ageDays = Number.isFinite(createdAtMs) && createdAtMs > 0
    ? Math.max(0, (new Date(now).getTime() - createdAtMs) / DAY_MS)
    : Number.POSITIVE_INFINITY;
  const ageBoost = Number.isFinite(ageDays) ? Math.exp(-ageDays / 45) * 0.65 : 0;
  return ageBoost + (product.isNewArrival ? 0.55 : 0) + (product.isFeatured ? 0.35 : 0);
}

function blendedPrice(preference, recentProfile) {
  const longTermPrice = Number(preference?.priceCount) > 0
    ? Number(preference.priceTotal) / Number(preference.priceCount)
    : 0;
  const recentPrice = Number(recentProfile?.priceCount) > 0
    ? Number(recentProfile.priceTotal) / Number(recentProfile.priceCount)
    : 0;
  if (longTermPrice && recentPrice) return (recentPrice * 0.7) + (longTermPrice * 0.3);
  return recentPrice || longTermPrice;
}

function productStyleKeys(product) {
  const values = [
    ...listValues(product.tags),
    ...queryTerms([product.name, product.category, product.brand].filter(Boolean).join(' '))
  ];
  return [...new Set(values.map(normalizeKey).filter(Boolean))].slice(0, 20);
}

function scoreProduct(product, { preference, recentProfile = createRecentProfile(), genderPreference = 'other', now = new Date() } = {}) {
  const category = normalizeKey(product.category);
  const brand = normalizeKey(product.brand);
  const gender = normalizeGender(product.gender);
  const components = {
    category: (boundedSignal(preferenceValue(preference?.categories, category)) * 2.4)
      + (boundedSignal(preferenceValue(recentProfile.categories, category)) * 3.4),
    brand: (boundedSignal(preferenceValue(preference?.brands, brand)) * 1.15)
      + (boundedSignal(preferenceValue(recentProfile.brands, brand)) * 1.7),
    genderHistory: (boundedSignal(genderSignalValue(preference?.genders, gender)) * 1.35)
      + (boundedSignal(genderSignalValue(recentProfile.genders, gender)) * 1.8),
    tags: 0,
    explicitGender: 0,
    price: 0,
    quality: ratingQuality(product),
    freshness: freshnessQuality(product, now),
    exposure: 0
  };

  const tagMatches = productStyleKeys(product).map((key) => (
    (boundedSignal(preferenceValue(preference?.tags, key)) * 0.65)
      + (boundedSignal(preferenceValue(recentProfile.tags, key)) * 1.05)
  ));
  components.tags = tagMatches.sort((a, b) => b - a).slice(0, 4).reduce((sum, value) => sum + value, 0);

  const preferredGender = normalizeGender(genderPreference);
  if (preferredGender === 'male' || preferredGender === 'female') {
    if (gender === preferredGender) components.explicitGender = 2.3;
    else if (gender === 'unisex' || gender === 'other') components.explicitGender = 0.75;
    else components.explicitGender = -2.75;
  }

  const preferredPrice = blendedPrice(preference, recentProfile);
  const price = Number(product.price);
  if (preferredPrice > 0 && Number.isFinite(price) && price > 0) {
    components.price = Math.exp(-Math.abs(Math.log(price / preferredPrice)) * 1.6) * 1.8;
  }

  components.exposure = -Math.min(2.4, boundedSignal(preferenceValue(recentProfile.productExposure, productId(product))) * 1.35);
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);
  const reasonCandidates = [
    ['category', components.category],
    ['brand', components.brand],
    ['style', components.tags],
    ['price', components.price],
    ['for-you', components.explicitGender],
    ['popular', components.quality],
    ['new-arrival', components.freshness]
  ];
  const reasons = reasonCandidates
    .filter(([, value]) => value >= 0.75)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason]) => reason);

  return { score, components, reasons };
}

function compareScoredProducts(a, b) {
  return b.score - a.score
    || Number(b.product.ratingCount || 0) - Number(a.product.ratingCount || 0)
    || Number(b.product.rating || 0) - Number(a.product.rating || 0)
    || new Date(b.product.createdAt || 0).getTime() - new Date(a.product.createdAt || 0).getTime()
    || productId(a.product).localeCompare(productId(b.product));
}

function rerankDiverse(scoredProducts, limit) {
  const remaining = [...scoredProducts].sort(compareScoredProducts);
  const selected = [];
  const categoryCounts = new Map();
  const brandCounts = new Map();

  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const category = normalizeKey(candidate.product.category);
      const brand = normalizeKey(candidate.product.brand);
      const adjustedScore = candidate.score
        - ((categoryCounts.get(category) || 0) * DIVERSITY_CATEGORY_PENALTY)
        - ((brandCounts.get(brand) || 0) * DIVERSITY_BRAND_PENALTY);
      if (adjustedScore > bestAdjustedScore
        || (adjustedScore === bestAdjustedScore && compareScoredProducts(candidate, remaining[bestIndex]) < 0)) {
        bestIndex = index;
        bestAdjustedScore = adjustedScore;
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push({ ...chosen, rankScore: bestAdjustedScore });
    const category = normalizeKey(chosen.product.category);
    const brand = normalizeKey(chosen.product.brand);
    if (category) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    if (brand) brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
  }

  return selected;
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

router.post('/events', requireUser, recommendationEventLimiter, async (req, res) => {
  try {
    const type = String(req.body?.type || '').trim();
    if (!EVENT_WEIGHTS[type]) return res.json({ ok: false, ignored: true });

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
  } catch (error) {
    console.warn('[recommendations:events] ignored event', error.message);
    res.json({ ok: false, ignored: true });
  }
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

router.get('/for-you', requireUser, recommendationReadLimiter, async (req, res) => {
  try {
    const limit = boundedLimit(req.query.limit, 8, 24);
    const now = new Date();
    const recentSince = new Date(now.getTime() - (RECENT_EVENT_WINDOW_DAYS * DAY_MS));
    const [preference, recentEvents, products] = await Promise.all([
      UserPreference.findOne({ user: req.user._id }).lean(),
      UserEvent.find({ user: req.user._id, createdAt: { $gte: recentSince } })
        .sort({ createdAt: -1 })
        .limit(250)
        .populate('product', 'category brand gender tags price')
        .lean(),
      productPoolCache.remember(
        `for-you-catalog:${recommendationCandidatePoolSize}`,
        () => Product.find(catalogFilter()).sort({ isFeatured: -1, createdAt: -1 }).limit(recommendationCandidatePoolSize).lean()
      )
    ]);
    const recentProfile = buildRecentProfile(recentEvents, now);
    const scoredProducts = products.map((product) => {
      const result = scoreProduct(product, {
        preference,
        recentProfile,
        genderPreference: req.user.genderPreference,
        now
      });
      return { product, ...result };
    });
    const ranked = rerankDiverse(scoredProducts, limit)
      .map(({ product, score, reasons }) => ({
        ...productToClient(product),
        recommendationScore: Math.round(score * 100) / 100,
        recommendationReasons: reasons
      }));

    res.json({
      products: ranked,
      personalized: Boolean(preference || recentProfile.signalCount || ['male', 'female'].includes(normalizeGender(req.user.genderPreference))),
      algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
      signalCount: recentProfile.signalCount
    });
  } catch (error) {
    console.error('[recommendations:for-you] failed', error.message);
    res.status(500).json({ message: 'Could not load recommendations' });
  }
});

router.get('/similar/:productId', recommendationReadLimiter, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.productId)) return res.status(404).json({ message: 'Product not found' });
  const limit = Math.min(Number(req.query.limit) || 4, 12);
  const cacheKey = `${req.params.productId}:${limit}`;
  try {
    const payload = await similarProductsCache.remember(cacheKey, async () => {
      const base = await Product.findOne({ _id: req.params.productId, isActive: true }).lean();
      if (!base) {
        const error = new Error('Product not found');
        error.statusCode = 404;
        throw error;
      }
      const products = await Product.find(catalogFilter({ _id: { $ne: base._id } })).limit(160).lean();
      const ranked = products
        .map((product) => ({ product, score: similarScore(base, product) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ product, score }) => ({ ...productToClient(product), recommendationScore: Math.round(score * 100) / 100 }));
      return { products: ranked };
    });
    res.json(payload);
  } catch (error) {
    res.status(error?.statusCode || 500).json({ message: error?.message || 'Could not load similar products' });
  }
});

export default router;
export {
  buildRecentProfile,
  clearRecommendationCaches,
  normalizeGender,
  ratingQuality,
  rerankDiverse,
  scoreProduct
};
