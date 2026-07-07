import express from 'express';
import fs from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CustomTryOn from '../models/CustomTryOn.js';
import ExternalTryOn from '../models/ExternalTryOn.js';
import Product from '../models/Product.js';
import TryOn, { tryOnToClient } from '../models/TryOn.js';
import User from '../models/User.js';
import { requireUser } from './auth.js';
import { inferTryOnModel, normalizeTryOnModel } from '../utils/tryOnModel.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const imageCacheTtlMs = Number(process.env.TRYON_IMAGE_CACHE_TTL_MS || 15 * 60 * 1000);
const imageCacheMaxItems = Number(process.env.TRYON_IMAGE_CACHE_MAX_ITEMS || 80);
const localImageDataUriCache = new Map();
const remoteImageDataUriCache = new Map();
const inFlightImageDataUriCache = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

function tokenCost() {
  const value = Number(process.env.TRYON_TOKEN_COST || 1);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 1;
}

function devMode(user) {
  return Boolean(user?.devMode);
}

function chargedTokenCost(user) {
  return devMode(user) ? 0 : tokenCost();
}

function redactLargeData(value) {
  if (typeof value === 'string') {
    return value.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]{120,}/gi, '[data image omitted]');
  }
  return value;
}

function readableError(value, fallback = 'Request failed') {
  if (!value) return fallback;
  if (typeof value === 'string') return redactLargeData(value);
  if (value instanceof Error) return readableError(value.message, fallback);
  if (typeof value === 'object') {
    const nested = value.message || value.detail || value.error || value.errors;
    if (nested && nested !== value) return readableError(nested, fallback);
    try {
      return redactLargeData(JSON.stringify(value, null, 2));
    } catch {
      return fallback;
    }
  }
  return redactLargeData(String(value));
}

function createTimer(label, meta = {}) {
  const start = performance.now();
  let last = start;
  console.log(`[tryon:${label}] start`, meta);
  return {
    mark(step, extra = {}) {
      const now = performance.now();
      console.log(`[tryon:${label}] ${step}`, {
        stepMs: Math.round(now - last),
        totalMs: Math.round(now - start),
        ...extra
      });
      last = now;
    },
    end(extra = {}) {
      const now = performance.now();
      console.log(`[tryon:${label}] done`, {
        totalMs: Math.round(now - start),
        ...extra
      });
    }
  };
}

function imageModel() {
  return process.env.FAL_TRYON_MODEL || 'openai/gpt-image-2/edit';
}

function virtualTryOnModel() {
  return process.env.FAL_VTO_MODEL || process.env.FAL_VTO_TRIAL_MODEL || 'fal-ai/image-apps-v2/virtual-try-on';
}

function tryOnModelForProduct(product) {
  return inferTryOnModel(product);
}

function imageQuality() {
  return process.env.FAL_IMAGE_QUALITY || 'low';
}

function imageSize() {
  const width = Number(process.env.FAL_IMAGE_WIDTH || 1024);
  const height = Number(process.env.FAL_IMAGE_HEIGHT || 768);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'auto';
  return { width, height };
}

function normalizeAspectRatio(value = '') {
  const ratio = String(value || process.env.FAL_VTO_ASPECT_RATIO || '3:4').trim();
  return /^(?:1:1|3:4|4:3|9:16|16:9)$/.test(ratio) ? ratio : '3:4';
}

function aspectRatioObject(value = '') {
  const label = normalizeAspectRatio(value);
  return { label, value: { ratio: label } };
}

function extensionFor(mimetype) {
  if (mimetype?.includes('png')) return '.png';
  if (mimetype?.includes('webp')) return '.webp';
  if (mimetype?.includes('gif')) return '.gif';
  return '.jpg';
}

function safeLocalPath(storedPath) {
  const resolved = path.resolve(rootDir, storedPath || '');
  if (!resolved.startsWith(rootDir)) throw new Error('Invalid image path');
  return resolved;
}

function dataUriFromBuffer(file, label) {
  if (!file?.buffer) throw new Error(`${label} image is missing`);
  const mimetype = file.mimetype || 'image/jpeg';
  return `data:${mimetype};base64,${file.buffer.toString('base64')}`;
}

function getCachedDataUri(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function setCachedDataUri(cache, key, value) {
  cache.set(key, { value, expiresAt: Date.now() + imageCacheTtlMs });
  while (cache.size > imageCacheMaxItems) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  return value;
}

async function cachedDataUri({ cache, key, timer, label, load }) {
  const cached = getCachedDataUri(cache, key);
  if (cached) {
    timer?.mark(`${label} cache hit`);
    return cached;
  }

  if (inFlightImageDataUriCache.has(key)) {
    timer?.mark(`${label} cache wait`);
    return inFlightImageDataUriCache.get(key);
  }

  const pending = load()
    .then((value) => setCachedDataUri(cache, key, value))
    .finally(() => inFlightImageDataUriCache.delete(key));
  inFlightImageDataUriCache.set(key, pending);
  return pending;
}

async function dataUriFromUpload(image, label, timer) {
  if (!image?.path) throw new Error(`${label} image is missing`);
  const localPath = safeLocalPath(image.path);
  const mimetype = image.mimetype || 'image/jpeg';
  const stats = await fs.stat(localPath);
  const key = `local:${localPath}:${stats.size}:${stats.mtimeMs}:${mimetype}`;
  return cachedDataUri({
    cache: localImageDataUriCache,
    key,
    timer,
    label,
    load: async () => {
      const bytes = await fs.readFile(localPath);
      return `data:${mimetype};base64,${bytes.toString('base64')}`;
    }
  });
}

async function dataUriFromProduct(product, timer) {
  if (product.image?.path) return dataUriFromUpload(product.image, 'product', timer);
  if (!product.image?.remoteUrl) throw new Error('Product image is missing');

  const key = `remote:${product.image.remoteUrl}`;
  return cachedDataUri({
    cache: remoteImageDataUriCache,
    key,
    timer,
    label: 'product',
    load: async () => {
      const response = await fetch(product.image.remoteUrl, {
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'user-agent': 'Mozilla/5.0 FitLook image fetcher'
        }
      });
      if (!response.ok) throw new Error('Could not fetch product image');
      const mimetype = response.headers.get('content-type') || 'image/jpeg';
      if (!mimetype.startsWith('image/')) throw new Error('Product image URL is not an image');
      const bytes = Buffer.from(await response.arrayBuffer());
      return `data:${mimetype};base64,${bytes.toString('base64')}`;
    }
  });
}

function tryOnPrompt(product) {
  return [
[
  'Generate a photorealistic e-commerce fashion try-on image. This is a standard apparel catalog photo, similar to images on Zara, ASOS, or Nordstrom product pages, showing how a real clothing item fits and drapes on a person.',
  'Reference image 1 is the shopper and is the only identity reference. Preserve their exact identity, face, facial features, hair, skin tone, body shape, pose, camera angle, crop, lighting, and background. Do not beautify, slim, age, sexualize, re-face, or otherwise alter the shopper.',
  `Reference image 2 is only the garment/product reference: "${product.name}" by ${product.brand}. If this product image contains a model, mannequin, face, hair, skin, hands, body, pose, or background, ignore all of those completely. Do not copy, blend, borrow, or average any identity, face, hairstyle, skin tone, body shape, pose, expression, or background from reference image 2.`,
  'Transfer only the visible clothing item from reference image 2 as-is, including its original color, fabric texture, neckline, sleeve length, hemline, cut, seams, buttons, logos, pockets, pattern, and silhouette. Do not modify the garment design.',
  'Fit the garment naturally onto the shopper with correct scale, seams, neckline, sleeve length, hem length, folds, shadows, occlusion, and fabric texture, matching how the garment fits in the original product photo.',
  'The final face must match reference image 1. Keep the shopper eyes, nose, mouth, jawline, facial proportions, hairline, hairstyle, and expression from reference image 1 unchanged.',
  'This is professional, non-sexualized commercial fashion photography intended for a retail product page. The pose, framing, and styling should remain catalog-appropriate and editorial in tone, consistent with mainstream fashion retail imagery.',
  'Keep the shopper hands, face, legs, footwear, and non-target clothing unchanged unless they must be naturally covered by the new garment.',
  'Do not invent extra accessories, logos, text, patterns, buttons, pockets, or colors that are not present in the product image.',
  'Return one clean full-body try-on image suitable for a product card, matching standard fashion e-commerce photography conventions.'
]
  ].join(' ');
}

function customTryOnPrompt() {
  return [
    'Create a photorealistic virtual try-on result for an ecommerce fashion app.',
    'Reference image 1 is the shopper and is the only identity reference. Preserve the shopper exact identity, face, facial features, hair, skin tone, body shape, pose, camera angle, crop, lighting, and background. Do not beautify, slim, age, re-face, or otherwise alter the person.',
    'Reference image 2 is only the clothing reference. If the clothing photo contains a model, mannequin, face, hair, skin, hands, body, pose, or background, ignore all of those completely. Do not copy, blend, borrow, or average any identity, face, hairstyle, skin tone, body shape, expression, pose, or background from reference image 2.',
    'Transfer only the visible garment from reference image 2 onto the shopper, keeping the garment color, fabric texture, neckline, sleeve length, hemline, cut, seams, buttons, logos, pockets, pattern, and silhouette.',
    'Fit the garment naturally with correct scale, seams, neckline, sleeve length, hem length, folds, shadows, occlusion, and fabric texture.',
    'The final face must match reference image 1. Keep the shopper eyes, nose, mouth, jawline, facial proportions, hairline, hairstyle, and expression from reference image 1 unchanged.',
    'Keep the shopper hands, face, legs, footwear, and non-target clothing unchanged unless they must be naturally covered by the uploaded garment.',
    'Do not invent extra accessories, logos, text, patterns, buttons, pockets, or colors that are not present in the clothing reference.',
    'Return one clean full-body try-on image.'
  ].join(' ');
}

function virtualTryOnProductPrompt(product) {
  const productName = product?.name || 'the selected product';
  const productBrand = product?.brand || 'the listed brand';

  return [
    'Create one photorealistic virtual try-on image for a fashion ecommerce product preview.',
    'The person photo is the base image, master reference, and absolute spatial ground truth.',
    'Preserve the person photo identity, face, head, hair, neck, skin tone, body shape, body proportions, pose, camera angle, crop, framing, zoom level, lighting, background, and scene perspective.',
    'The final image must always include the complete head and full face from the person photo inside the frame. The forehead, hair, ears, eyes, nose, mouth, chin, jawline, and neck must remain visible exactly as in the person photo unless already hidden in the person photo.',
    'Never crop, trim, zoom past, cover, blur, regenerate, stylize, replace, blend, beautify, age, slim, or partially hide the face, head, hair, or neck.',
    'The pose is locked. Preserve the exact body geometry and every visible landmark: head tilt, shoulders, torso, waist, hips, arms, elbows, wrists, hands, fingers, legs, knees, ankles, feet, and weight distribution.',
    'Do not move, rotate, bend, extend, raise, lower, straighten, recenter, reframe, reshape, resize, or synthesize any body part.',
    'If the requested aspect ratio needs more canvas, add only plain neutral background sampled from the original background around the person. Never create space by cropping the person, zooming in, or hiding the head or face.',
    `Use the clothing/product photo only as the garment reference for "${productName}" by ${productBrand}.`,
    'If the product photo contains a model, mannequin, face, hair, skin, hands, body, pose, expression, camera angle, crop, lighting, or background, ignore all of those completely.',
    'Never copy, borrow, blend, infer, or transfer identity, face, hairstyle, body, pose, anatomy, framing, crop, camera angle, expression, skin tone, proportions, or background from the product photo.',
    'Transfer only the garment design: color, pattern, texture, fabric, neckline, collar, straps, sleeve length, hemline, seams, buttons, logos, pockets, closures, trims, and silhouette.',
    'Fit the garment naturally onto the existing person pose with correct scale, drape, folds, wrinkles, tension, occlusion, shadows, and fabric behavior.',
    'The garment must adapt to the person; the person must never adapt to the garment.',
    'Do not invent extra accessories, logos, text, patterns, buttons, pockets, skin exposure, body changes, styling changes, or background details.',
    'Every non-garment region must remain visually unchanged from the person photo.',
    'Return one clean, non-sexualized, photorealistic, full-body ecommerce try-on image. The only visible change should be the selected garment.'
  ].join(' ');
}

function virtualTryOnCustomPrompt() {
  return [
    'Create a photorealistic virtual try-on image for a standard fashion retail preview.',
    'Treat the person photo as the base image and absolute spatial ground truth. Preserve the exact identity, face, facial features, hair, skin tone, body shape, body proportions, pose, camera angle, framing, crop, lighting, and background from the person photo.',
    'Only the clothing pixels required for the uploaded garment may change. Every non-garment region must remain visually unchanged from the person photo.',
    'The face, hair, neck, hands, fingers, legs, feet, accessories, background, lighting, shadows outside the garment, camera perspective, and crop are protected and must not be modified.',
    'The final frame must always include the complete head and face from the person photo. Do not crop, trim, zoom past, or cut off the forehead, chin, hair, ears, jawline, or any part of the face.',
    'If more canvas is needed to fit the garment or aspect ratio, add only plain neutral background around the person. Never solve framing by cropping the person or hiding the face.',
    'The final face must be the exact same face from the person photo. Do not replace, blend, beautify, age, slim, re-face, crop, blur, hide, stylize, or borrow facial/body features from any other image.',
    'Use the uploaded clothing image only as the garment reference.',
    'If the clothing image contains a model, mannequin, face, hair, skin, hands, body, pose, expression, camera angle, crop, or background, ignore all of those completely.',
    'Never copy, borrow, blend, infer, or transfer any pose, body positioning, framing, crop, camera angle, identity, hairstyle, skin tone, expression, proportions, anatomy, or background from the clothing image.',
    'Transfer only the garment material and design attributes: color, pattern, texture, neckline, sleeve length, hemline, straps, buttons, logos, seams, pockets, closures, and silhouette.',
    'Fit the garment naturally onto the existing body pose with correct scale, folds, seams, shadows, occlusion, and fabric texture.',
    'Adapt the garment to the person; never adapt the person to the garment.',
    'Keep the result non-sexualized and ecommerce-catalog appropriate. Do not exaggerate body shape, skin exposure, pose, expression, or styling.',
    'Maintain natural fabric coverage based on the garment design without inventing extra skin exposure or extra accessories.',
    'If the requested aspect ratio creates extra empty canvas space, fill only that extra space with a plain neutral base color sampled from the original background. Do not generate extra body parts, clothing, scenery, floor, wall, shadows, or background details.',
    'Return one clean, full-body, photorealistic result suitable for an ecommerce preview. The only visible change should be the uploaded garment.'
  ].join(' ');
}

function isFalContentPolicyError(message = '') {
  return /content[_\s-]?policy|content checker|flagged/i.test(String(message));
}

function falHeaders() {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is missing on the server');
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function falJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...falHeaders(), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readableError(data.detail || data.error || data.message || data, 'FAL try-on request failed'));
  return data;
}

async function waitForFalResult(submission, timer) {
  const statusUrl = submission.status_url;
  const responseUrl = submission.response_url;
  if (!statusUrl || !responseUrl) throw new Error('FAL did not return queue URLs');

  const configuredAttempts = Number(timer?.maxAttempts || 90);
  const configuredPollMs = Number(timer?.pollMs || 1500);
  const maxAttempts = Number.isFinite(configuredAttempts) && configuredAttempts > 0 ? configuredAttempts : 90;
  const pollMs = Number.isFinite(configuredPollMs) && configuredPollMs > 0 ? configuredPollMs : 1500;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await falJson(statusUrl);
    if (attempt === 0 || attempt % 5 === 0) timer?.mark('fal status poll', { attempt, status: status.status });
    if (status.status === 'COMPLETED') {
      timer?.mark('fal completed', { attempt });
      return falJson(responseUrl);
    }
    if (status.status === 'FAILED' || status.error) throw new Error(readableError(status.error || status, 'FAL try-on generation failed'));
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`FAL try-on generation timed out after ${Math.round((maxAttempts * pollMs) / 1000)} seconds`);
}

function firstGeneratedImageUrl(value, depth = 0) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') return /^https?:\/\//i.test(value) || /^data:image\//i.test(value) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstGeneratedImageUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['url', 'image_url', 'imageUrl']) {
    const found = firstGeneratedImageUrl(value[key], depth + 1);
    if (found) return found;
  }
  for (const key of ['images', 'image', 'output', 'result', 'data']) {
    const found = firstGeneratedImageUrl(value[key], depth + 1);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = firstGeneratedImageUrl(child, depth + 1);
    if (found) return found;
  }
  return '';
}

function shortUrlForLog(url = '') {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'generated image URL';
  }
}

async function generatedBytesFromUrl(url, timer) {
  if (/^data:image\//i.test(url)) {
    const [, metadata = '', base64 = ''] = url.match(/^data:([^;]+);base64,(.+)$/i) || [];
    if (!base64) throw new Error('Generated image data URI was invalid');
    return {
      bytes: Buffer.from(base64, 'base64'),
      mimetype: metadata || 'image/png'
    };
  }

  let lastStatus = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 FitLook generated image fetcher'
      }
    });
    if (response.ok) {
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        mimetype: response.headers.get('content-type') || 'image/png'
      };
    }
    lastStatus = `${response.status} ${response.statusText}`.trim();
    timer?.mark('generated image download retry', {
      attempt,
      status: lastStatus,
      url: shortUrlForLog(url)
    });
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
  }

  throw new Error(`Could not download generated try-on image from ${shortUrlForLog(url)} (${lastStatus || 'request failed'})`);
}

async function callFalVirtualTryOnProduct({ user, product, timer }) {
  const [person, garment] = await Promise.all([
    dataUriFromUpload(user.bodyPhoto, 'person', timer),
    dataUriFromProduct(product, timer)
  ]);
  timer?.mark('vto reference images prepared', {
    personKb: Math.round(person.length / 1024),
    garmentKb: Math.round(garment.length / 1024)
  });

  const endpoint = virtualTryOnModel();
  const ratio = aspectRatioObject();
  const prompt = virtualTryOnProductPrompt(product);
  const payload = {
    person_image_url: person,
    clothing_image_url: garment,
    preserve_pose: true,
    aspect_ratio: ratio.value
  };
  const vtoTimer = {
    ...timer,
    maxAttempts: Number(process.env.FAL_VTO_POLL_ATTEMPTS || 240),
    pollMs: Number(process.env.FAL_VTO_POLL_MS || 1500)
  };

  try {
    timer?.mark('fal vto submit attempt', {
      fields: Object.keys(payload),
      aspectRatio: ratio.label,
      preservePose: true,
      unsupportedControls: 'seed/mask/identity/prompt not in FAL schema'
    });
    const submission = await falJson(`https://queue.fal.run/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    timer?.mark('fal vto submitted', { requestId: submission.request_id });
    const result = await waitForFalResult(submission, vtoTimer);
    const generatedUrl = firstGeneratedImageUrl(result);
    if (!generatedUrl) throw new Error(`FAL returned no image. Response keys: ${Object.keys(result || {}).join(', ')}`);
    const { bytes, mimetype } = await generatedBytesFromUrl(generatedUrl, timer);
    timer?.mark('vto generated image downloaded', {
      outputKb: Math.round(bytes.length / 1024),
      aspectRatio: ratio.label
    });
    return {
      bytes,
      mimetype,
      prompt,
      model: endpoint,
      quality: `vto ${ratio.label}`
    };
  } catch (error) {
    const message = readableError(error, 'FAL virtual try-on failed');
    if (isFalContentPolicyError(message)) {
      throw new Error('FAL VTO accepted the product payload, but its content checker blocked this person/clothing pair. Try a clearer fully clothed person photo or switch this product back to GPT Image 2.');
    }
    throw new Error(message);
  }
}

async function callFalVirtualTryOnCustom({ user, garmentDataUri, timer }) {
  const person = await dataUriFromUpload(user.bodyPhoto, 'person', timer);
  timer?.mark('custom vto reference images prepared', {
    personKb: Math.round(person.length / 1024),
    garmentKb: Math.round(garmentDataUri.length / 1024)
  });

  const endpoint = virtualTryOnModel();
  const ratio = aspectRatioObject();
  const prompt = virtualTryOnCustomPrompt();
  const payload = {
    person_image_url: person,
    clothing_image_url: garmentDataUri,
    preserve_pose: true,
    aspect_ratio: ratio.value
  };
  const vtoTimer = {
    ...timer,
    maxAttempts: Number(process.env.FAL_VTO_POLL_ATTEMPTS || 240),
    pollMs: Number(process.env.FAL_VTO_POLL_MS || 1500)
  };

  try {
    timer?.mark('fal custom vto submit attempt', {
      fields: Object.keys(payload),
      aspectRatio: ratio.label,
      preservePose: true,
      unsupportedControls: 'seed/mask/identity/prompt not in FAL schema'
    });
    const submission = await falJson(`https://queue.fal.run/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    timer?.mark('fal custom vto submitted', { requestId: submission.request_id });
    const result = await waitForFalResult(submission, vtoTimer);
    const generatedUrl = firstGeneratedImageUrl(result);
    if (!generatedUrl) throw new Error(`FAL returned no image. Response keys: ${Object.keys(result || {}).join(', ')}`);
    const { bytes, mimetype } = await generatedBytesFromUrl(generatedUrl, timer);
    timer?.mark('custom vto generated image downloaded', {
      outputKb: Math.round(bytes.length / 1024),
      aspectRatio: ratio.label
    });
    return {
      bytes,
      mimetype,
      prompt,
      model: endpoint,
      quality: `vto ${ratio.label}`
    };
  } catch (error) {
    const message = readableError(error, 'FAL custom virtual try-on failed');
    if (isFalContentPolicyError(message)) {
      throw new Error('FAL VTO accepted the custom payload, but its content checker blocked this person/clothing pair. Try a clearer fully clothed person photo or a clearer clothing image.');
    }
    throw new Error(message);
  }
}

async function callFalImageEdit({ user, product, garmentDataUri, prompt, timer }) {
  const [person, garment] = await Promise.all([
    dataUriFromUpload(user.bodyPhoto, 'person', timer),
    garmentDataUri ? Promise.resolve(garmentDataUri) : dataUriFromProduct(product, timer)
  ]);
  timer?.mark('reference images prepared', {
    personKb: Math.round(person.length / 1024),
    garmentKb: Math.round(garment.length / 1024)
  });
  const finalPrompt = prompt || tryOnPrompt(product);
  const endpoint = imageModel();
  const submission = await falJson(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: finalPrompt,
      image_urls: [person, garment],
      image_size: imageSize(),
      quality: imageQuality(),
      num_images: 1,
      output_format: 'png'
    })
  });
  timer?.mark('fal submitted', { requestId: submission.request_id });
  const result = await waitForFalResult(submission, timer);
  timer?.mark('fal result fetched');
  const generated = result.images?.[0];
  if (!generated?.url) throw new Error('FAL did not return an image');
  const imageResponse = await fetch(generated.url);
  if (!imageResponse.ok) throw new Error('Could not download generated try-on image');
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  timer?.mark('generated image downloaded', { outputKb: Math.round(bytes.length / 1024) });
  return { bytes, prompt: finalPrompt };
}

async function saveUserCacheFile({ user, bytes, filename, mimetype }) {
  const userId = user._id.toString();
  const storedPath = path.posix.join('uploads', 'users', userId, 'tryons', filename);
  await fs.mkdir(path.join(rootDir, 'uploads', 'users', userId, 'tryons'), { recursive: true });
  await fs.writeFile(path.join(rootDir, storedPath), bytes);
  return {
    filename,
    path: storedPath,
    mimetype,
    size: bytes.length
  };
}

async function saveGeneratedTryOn({ user, product, timer }) {
  const selectedModel = tryOnModelForProduct(product);
  timer?.mark('try-on model selected', { selectedModel });
  const generated = selectedModel === 'vto-unrestricted'
    ? await callFalVirtualTryOnProduct({ user, product, timer })
    : {
        ...(await callFalImageEdit({ user, product, timer })),
        mimetype: 'image/png',
        model: imageModel(),
        quality: imageQuality()
      };
  const filename = `tryon-${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFor(generated.mimetype)}`;
  const image = await saveUserCacheFile({ user, bytes: generated.bytes, filename, mimetype: generated.mimetype });
  timer?.mark('generated image saved', { path: image.path });

  return TryOn.create({
    user: user._id,
    product: product._id,
    provider: 'fal',
    model: generated.model,
    quality: generated.quality,
    prompt: generated.prompt,
    tokenCost: chargedTokenCost(user),
    image
  });
}

function cleanUrl(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function externalProductFromBody(value = {}) {
  const sourceUrl = cleanUrl(value.sourceUrl || value.affiliateLink);
  const imageUrl = cleanUrl(value.imageUrl || value.remoteImageUrl);
  if (!sourceUrl) throw new Error('External product link is missing');
  if (!imageUrl) throw new Error('External product image is missing');
  return {
    sourceUrl,
    affiliateLink: cleanUrl(value.affiliateLink || sourceUrl),
    name: String(value.name || 'Amazon product').trim(),
    brand: String(value.brand || 'Amazon').trim(),
    category: String(value.category || 'clothing').trim(),
    description: String(value.description || '').trim(),
    tags: Array.isArray(value.tags) ? value.tags : [],
    tryOnModel: inferTryOnModel(value),
    imageUrl,
    image: { remoteUrl: imageUrl }
  };
}

async function saveGeneratedExternalTryOn({ user, product, timer }) {
  const selectedModel = tryOnModelForProduct(product);
  timer?.mark('external try-on model selected', { selectedModel });
  const generated = selectedModel === 'vto-unrestricted'
    ? await callFalVirtualTryOnProduct({ user, product, timer })
    : {
        ...(await callFalImageEdit({ user, product, timer })),
        mimetype: 'image/png',
        model: imageModel(),
        quality: imageQuality()
      };
  const filename = `tryon-external-${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFor(generated.mimetype)}`;
  const image = await saveUserCacheFile({ user, bytes: generated.bytes, filename, mimetype: generated.mimetype });
  timer?.mark('external try-on saved', { path: image.path });

  return ExternalTryOn.create({
    user: user._id,
    sourceUrl: product.sourceUrl,
    affiliateLink: product.affiliateLink,
    productName: product.name,
    brand: product.brand,
    category: product.category,
    imageUrl: product.imageUrl,
    provider: 'fal',
    model: generated.model,
    quality: generated.quality,
    prompt: generated.prompt,
    tokenCost: chargedTokenCost(user),
    image
  });
}

async function saveUploadFile(file, prefix, user) {
  const filename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFor(file.mimetype)}`;
  const storedPath = user
    ? path.posix.join('uploads', 'users', user._id.toString(), 'garments', filename)
    : path.posix.join('uploads', filename);
  await fs.mkdir(path.dirname(path.join(rootDir, storedPath)), { recursive: true });
  await fs.writeFile(path.join(rootDir, storedPath), file.buffer);
  return {
    filename,
    path: storedPath,
    mimetype: file.mimetype,
    size: file.size
  };
}

async function saveGeneratedCustomTryOn({ user, garmentFile, tryOnModel, timer }) {
  const garmentDataUri = dataUriFromBuffer(garmentFile, 'garment');
  timer?.mark('custom garment prepared', { garmentKb: Math.round(garmentDataUri.length / 1024) });
  const selectedModel = normalizeTryOnModel(tryOnModel);
  timer?.mark('custom try-on model selected', { selectedModel });
  const generated = selectedModel === 'vto-unrestricted'
    ? await callFalVirtualTryOnCustom({ user, garmentDataUri, timer })
    : {
        ...(await callFalImageEdit({
          user,
          garmentDataUri,
          prompt: customTryOnPrompt(),
          timer
        })),
        mimetype: 'image/png',
        model: imageModel(),
        quality: imageQuality()
      };
  const filename = `tryon-custom-${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFor(generated.mimetype)}`;
  const image = await saveUserCacheFile({ user, bytes: generated.bytes, filename, mimetype: generated.mimetype });
  const garment = await saveUploadFile(garmentFile, 'garment', user);
  timer?.mark('custom try-on saved', { path: image.path });

  return CustomTryOn.create({
    user: user._id,
    provider: 'fal',
    model: generated.model,
    quality: generated.quality,
    prompt: generated.prompt,
    tokenCost: chargedTokenCost(user),
    garment,
    image
  });
}

async function reserveToken(user, timer) {
  if (devMode(user)) {
    timer.mark('dev mode token bypass', { tokensRemaining: user.tokens, cost: 0 });
    return user;
  }
  const cost = tokenCost();
  const chargedUser = await User.findOneAndUpdate(
    { _id: user._id, tokens: { $gte: cost } },
    { $inc: { tokens: -cost } },
    { new: true }
  );
  if (!chargedUser) return null;
  timer.mark('token reserved', { tokensRemaining: chargedUser.tokens, cost });
  return chargedUser;
}

async function refundToken(user, timer) {
  if (devMode(user)) {
    timer.mark('dev mode refund skipped', { tokensRemaining: user.tokens, cost: 0 });
    return user;
  }
  const cost = tokenCost();
  const refundedUser = await User.findByIdAndUpdate(user._id, { $inc: { tokens: cost } }, { new: true });
  if (refundedUser) timer.mark('token refunded', { cost, tokensRemaining: refundedUser.tokens });
  return refundedUser || user;
}

router.get('/', requireUser, async (req, res) => {
  const ids = String(req.query.productIds || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 96);
  const filter = { user: req.user._id };
  if (ids.length) filter.product = { $in: ids };
  const tryOns = await TryOn.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ tryOns: tryOns.map(tryOnToClient) });
});

router.post('/custom', requireUser, upload.single('garment'), async (req, res) => {
  const timer = createTimer('custom', { userId: req.user._id.toString() });
  let reserved = false;

  try {
    if (!req.file) return res.status(400).json({ message: 'Upload a clothing image first' });
    const chargedUser = await reserveToken(req.user, timer);
    if (!chargedUser) {
      timer.end({ error: 'insufficient tokens' });
      return res.status(402).json({ message: 'Not enough tokens for AI try-on' });
    }
    reserved = true;
    req.user = chargedUser;

    const tryOn = await saveGeneratedCustomTryOn({
      user: req.user,
      garmentFile: req.file,
      tryOnModel: req.body?.tryOnModel,
      timer
    });
    timer.end({ tokensRemaining: req.user.tokens });
    res.status(201).json({ tryOn: tryOn.toClient(), user: req.user.toClient() });
  } catch (error) {
    if (reserved) req.user = await refundToken(req.user, timer);
    const message = readableError(error, 'Could not generate custom AI try-on');
    timer.end({ error: message });
    res.status(400).json({ message });
  }
});

router.post('/external', requireUser, async (req, res) => {
  let product;
  try {
    product = externalProductFromBody(req.body?.product);
  } catch (error) {
    return res.status(400).json({ message: readableError(error, 'External product is missing') });
  }

  const timer = createTimer('external', {
    userId: req.user._id.toString(),
    sourceUrl: product.sourceUrl
  });
  let reserved = false;

  try {
    const existing = await ExternalTryOn.findOne({ user: req.user._id, sourceUrl: product.sourceUrl });
    if (existing) {
      timer.end({ reused: true });
      return res.json({ tryOn: existing.toClient(), user: req.user.toClient(), reused: true });
    }

    const chargedUser = await reserveToken(req.user, timer);
    if (!chargedUser) {
      timer.end({ error: 'insufficient tokens' });
      return res.status(402).json({ message: 'Not enough tokens for AI try-on' });
    }
    reserved = true;
    req.user = chargedUser;

    const tryOn = await saveGeneratedExternalTryOn({ user: req.user, product, timer });
    timer.end({ reused: false, tokensRemaining: req.user.tokens });
    res.status(201).json({ tryOn: tryOn.toClient(), user: req.user.toClient(), reused: false });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await ExternalTryOn.findOne({ user: req.user._id, sourceUrl: product.sourceUrl });
      if (existing) {
        if (reserved) {
          req.user = await refundToken(req.user, timer);
          reserved = false;
        }
        timer.end({ reused: true, duplicate: true });
        return res.json({ tryOn: existing.toClient(), user: req.user.toClient(), reused: true });
      }
    }
    if (reserved) req.user = await refundToken(req.user, timer);
    const message = readableError(error, 'Could not generate external AI try-on');
    timer.end({ error: message });
    res.status(400).json({ message });
  }
});

router.post('/:productId', requireUser, async (req, res) => {
  const timer = createTimer('generate', {
    userId: req.user._id.toString(),
    productId: req.params.productId
  });
  let reserved = false;

  try {
    const product = await Product.findOne({ _id: req.params.productId, isActive: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    timer.mark('product loaded', { tryOnModel: tryOnModelForProduct(product) });

    const existing = await TryOn.findOne({ user: req.user._id, product: req.params.productId });
    if (existing) {
      timer.end({ reused: true });
      return res.json({ tryOn: existing.toClient(), user: req.user.toClient(), reused: true });
    }

    const chargedUser = await reserveToken(req.user, timer);
    if (!chargedUser) {
      timer.end({ error: 'insufficient tokens' });
      return res.status(402).json({ message: 'Not enough tokens for AI try-on' });
    }
    reserved = true;
    req.user = chargedUser;

    const tryOn = await saveGeneratedTryOn({ user: req.user, product, timer });
    timer.end({ reused: false, tokensRemaining: req.user.tokens });

    res.status(201).json({ tryOn: tryOn.toClient(), user: req.user.toClient(), reused: false });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await TryOn.findOne({ user: req.user._id, product: req.params.productId });
      if (existing) {
        if (reserved) {
          req.user = await refundToken(req.user, timer);
          reserved = false;
        }
        timer.end({ reused: true, duplicate: true });
        return res.json({ tryOn: existing.toClient(), user: req.user.toClient(), reused: true });
      }
    }
    if (reserved) {
      req.user = await refundToken(req.user, timer);
    }
    const message = readableError(error, 'Could not generate AI try-on');
    timer.end({ error: message });
    res.status(400).json({ message });
  }
});

export default router;
