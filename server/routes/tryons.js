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
import { wearableCompatibility } from '../utils/wearable.js';
import { genderCompatibility } from '../utils/genderPreference.js';

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
  if (typeof value === 'string') {
    if (/content[_\s-]?policy|safety|flagged|content[_\s-]?policy[_\s-]?violation/i.test(value)) {
      return 'This try-on was blocked by the image provider safety check. Please try again with the fitted/swimwear try-on mode.';
    }
    return redactLargeData(value);
  }
  if (value instanceof Error) return readableError(value.message, fallback);
  if (Array.isArray(value)) {
    const policyError = value.find((item) => /content[_\s-]?policy|safety|flagged/i.test([item?.type, item?.code, item?.msg, item?.message].filter(Boolean).join(' ')));
    if (policyError) {
      return 'This try-on was blocked by the image provider safety check. FitLook will use the fitted/swimwear try-on mode for this product.';
    }
    const imageSizeError = value.find((item) => item?.type === 'image_too_small');
    if (imageSizeError) {
      const index = imageSizeError.loc?.[2] ?? imageSizeError.loc?.[1];
      const label = index === 1 ? 'product' : index === 0 ? 'profile' : 'reference';
      return `${label} image is too small for Wan 2.6. Wan requires every reference image to be at least 384x384px. Use a larger product photo.`;
    }
    return value.map((item) => readableError(item, fallback)).filter(Boolean).join(' ') || fallback;
  }
  if (typeof value === 'object') {
    const policyText = [value.type, value.code, value.msg, value.message, value.error].filter((item) => typeof item === 'string').join(' ');
    if (/content[_\s-]?policy|safety|flagged/i.test(policyText)) {
      return 'This try-on was blocked by the image provider safety check. FitLook will use the fitted/swimwear try-on mode for this product.';
    }
    if (value.type === 'image_too_small') {
      return 'Reference image is too small for Wan 2.6. Wan requires every reference image to be at least 384x384px.';
    }
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

function wanImageToImageModel() {
  return process.env.FAL_WAN_IMAGE_TO_IMAGE_MODEL || 'wan/v2.6/image-to-image';
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

function wanImageSize() {
  const width = Number(process.env.FAL_WAN_IMAGE_WIDTH || 1024);
  const height = Number(process.env.FAL_WAN_IMAGE_HEIGHT || 1280);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'portrait_4_3';
  return { width, height };
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

function dataUriFromBuffer(file, label, options = {}) {
  if (!file?.buffer) throw new Error(`${label} image is missing`);
  const mimetype = file.mimetype || 'image/jpeg';
  ensureMinimumImageDimensions({
    bytes: file.buffer,
    label,
    minWidth: Number(options.minWidth || 0),
    minHeight: Number(options.minHeight || 0)
  });
  return `data:${mimetype};base64,${file.buffer.toString('base64')}`;
}

function imageDimensionsFromBuffer(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32) return null;
  if (bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (!length || offset + length + 2 > bytes.length) return null;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X' && bytes.length >= 30) return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (type === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (type === 'VP8L' && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function ensureMinimumImageDimensions({ bytes, label, minWidth, minHeight }) {
  if (!minWidth && !minHeight) return null;
  const dimensions = imageDimensionsFromBuffer(bytes);
  if (!dimensions) throw new Error(`${label} image dimensions could not be read. Wan 2.6 requires 384x384px or larger reference images.`);
  if (dimensions.width < minWidth || dimensions.height < minHeight) {
    throw new Error(`${label} image is ${dimensions.width}x${dimensions.height}px. Wan 2.6 requires each reference image to be at least ${minWidth}x${minHeight}px. Use a larger product photo.`);
  }
  return dimensions;
}

function highResolutionAmazonImageUrl(value = '') {
  const url = String(value || '').trim();
  if (!/https?:\/\/(?:[^/]+\.)?(?:media-amazon|ssl-images-amazon)\.[^/]+\/images\//i.test(url)) return '';
  return url.replace(/\._[^/]*_\.(jpe?g|png|webp)(?:\?.*)?$/i, '.$1');
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

async function dataUriFromUpload(image, label, timer, options = {}) {
  if (!image?.path) throw new Error(`${label} image is missing`);
  const localPath = safeLocalPath(image.path);
  const mimetype = image.mimetype || 'image/jpeg';
  const stats = await fs.stat(localPath);
  const minWidth = Number(options.minWidth || 0);
  const minHeight = Number(options.minHeight || 0);
  const key = `local:${localPath}:${stats.size}:${stats.mtimeMs}:${mimetype}:${minWidth || ''}x${minHeight || ''}`;
  return cachedDataUri({
    cache: localImageDataUriCache,
    key,
    timer,
    label,
    load: async () => {
      const bytes = await fs.readFile(localPath);
      const dimensions = ensureMinimumImageDimensions({ bytes, label, minWidth, minHeight });
      if (dimensions) timer?.mark(`${label} dimensions checked`, dimensions);
      return `data:${mimetype};base64,${bytes.toString('base64')}`;
    }
  });
}

async function dataUriFromProduct(product, timer, options = {}) {
  if (product.image?.path) return dataUriFromUpload(product.image, 'product', timer, options);
  if (!product.image?.remoteUrl) throw new Error('Product image is missing');

  const minWidth = Number(options.minWidth || 0);
  const minHeight = Number(options.minHeight || 0);
  const originalUrl = product.image.remoteUrl;
  const highResUrl = highResolutionAmazonImageUrl(originalUrl);
  const candidateUrls = highResUrl && highResUrl !== originalUrl ? [highResUrl, originalUrl] : [originalUrl];
  const key = `remote:${candidateUrls[0]}:${minWidth || ''}x${minHeight || ''}`;
  return cachedDataUri({
    cache: remoteImageDataUriCache,
    key,
    timer,
    label: 'product',
    load: async () => {
      let lastError;
      for (const url of candidateUrls) {
        try {
          const response = await fetch(url, {
            headers: {
              accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              'user-agent': 'Mozilla/5.0 FitLook image fetcher'
            }
          });
          if (!response.ok) throw new Error('Could not fetch product image');
          const mimetype = response.headers.get('content-type') || 'image/jpeg';
          if (!mimetype.startsWith('image/')) throw new Error('Product image URL is not an image');
          const bytes = Buffer.from(await response.arrayBuffer());
          const dimensions = ensureMinimumImageDimensions({ bytes, label: 'product', minWidth, minHeight });
          if (dimensions) timer?.mark('product dimensions checked', { ...dimensions, highRes: url !== originalUrl });
          return `data:${mimetype};base64,${bytes.toString('base64')}`;
        } catch (error) {
          lastError = error;
          if (url !== candidateUrls[candidateUrls.length - 1]) timer?.mark('product image candidate failed', { error: readableError(error) });
        }
      }
      throw lastError || new Error('Could not fetch product image');
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
  'The output must show the shopper full body from head to toe, including complete face, hair, both arms, both legs, and both feet or footwear, fully visible within the frame with no cropping at the head, waist, knees, or ankles.',
  'Return one clean full-body try-on image suitable for a product card, matching standard fashion e-commerce photography conventions.'
]
  ].join(' ');
}

function wanTryOnPrompt(product) {
  const productName = String(product?.name || 'the selected garment').slice(0, 220);
  const productBrand = String(product?.brand || 'the listed brand').slice(0, 120);
  return [
    'Create one photorealistic virtual try-on image for an ecommerce product page.',
    'Image 1 is the shopper and must remain the identity, body, pose, camera, lighting, and background reference.',
    'Preserve the shopper face, hair, skin tone, body shape, hands, legs, pose, framing, and expression exactly.',
    `Image 2 is only the garment reference for "${productName}" by ${productBrand}.`,
    'Transfer only the garment design, color, fabric, texture, neckline, sleeves, hem, seams, closures, logos, pattern, pockets, and silhouette from image 2.',
    'Ignore any model, mannequin, person, face, body, pose, camera angle, crop, lighting, and background present in image 2.',
    'Fit the garment naturally onto the shopper with correct scale, drape, folds, wrinkles, occlusion, and shadows.',
    'Keep every non-garment region from image 1 unchanged. Do not add accessories, styling, text, logos, background details, body changes, or extra skin exposure.',
    'The output must show the shopper full body from head to toe, including complete face, hair, both arms, both legs, and both feet or footwear, fully visible within the frame with no cropping at the head, waist, knees, or ankles.',
    'Return one clean, full-body, non-sexualized, photorealistic retail try-on preview.'
  ].join(' ');
}

function wanCustomTryOnPrompt() {
  return [
    'Create one photorealistic virtual try-on image for an ecommerce clothing preview.',
    'Image 1 is the shopper and must remain the identity, body, pose, camera, lighting, and background reference.',
    'Preserve the shopper face, hair, skin tone, body shape, hands, legs, pose, framing, and expression exactly.',
    'Image 2 is only the uploaded garment reference.',
    'Transfer only the garment design, color, fabric, texture, neckline, sleeves, hem, seams, closures, logos, pattern, pockets, and silhouette from image 2.',
    'Ignore any model, mannequin, person, face, body, pose, camera angle, crop, lighting, and background present in image 2.',
    'Fit the garment naturally onto the shopper with correct scale, drape, folds, wrinkles, occlusion, and shadows.',
    'Keep every non-garment region from image 1 unchanged. Do not add accessories, styling, text, logos, background details, body changes, or extra skin exposure.',
    'The output must show the shopper full body from head to toe, including complete face, hair, both arms, both legs, and both feet or footwear, fully visible within the frame with no cropping at the head, waist, knees, or ankles.',
    'Return one clean, full-body, non-sexualized, photorealistic retail try-on preview.'
  ].join(' ');
}

function wanNegativePrompt() {
  return 'low resolution, blurry, distorted face, changed identity, changed pose, changed body, extra limbs, extra fingers, missing head, cropped face, cropped body, cropped legs, cropped feet, half body, waist-up, close-up crop, copied product model, mannequin, text, watermark, logo hallucination, overexposed, low quality, two images, split screen, side by side, diptych, collage, grid, multiple panels, duplicate image, before and after, two people, comparison layout';
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
    'The output must show the shopper full body from head to toe, including complete face, hair, both arms, both legs, and both feet or footwear, fully visible within the frame with no cropping at the head, waist, knees, or ankles.',
    'Return one clean full-body try-on image.'
  ].join(' ');
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

async function callFalWanImageToImage({ user, product, garmentDataUri, prompt, timer }) {
  const minReferenceSize = 384;
  const [person, garment] = await Promise.all([
    dataUriFromUpload(user.bodyPhoto, 'person', timer, { minWidth: minReferenceSize, minHeight: minReferenceSize }),
    garmentDataUri ? Promise.resolve(garmentDataUri) : dataUriFromProduct(product, timer, { minWidth: minReferenceSize, minHeight: minReferenceSize })
  ]);
  timer?.mark('wan reference images prepared', {
    personKb: Math.round(person.length / 1024),
    garmentKb: Math.round(garment.length / 1024)
  });

  const endpoint = wanImageToImageModel();
  const finalPrompt = prompt || wanTryOnPrompt(product);
  const payload = {
    prompt: finalPrompt,
    image_urls: [person, garment],
    negative_prompt: wanNegativePrompt(),
    image_size: wanImageSize(),
    num_images: 1,
    enable_prompt_expansion: false,
    enable_safety_checker: true
  };
  const wanTimer = {
    ...timer,
    maxAttempts: Number(process.env.FAL_WAN_POLL_ATTEMPTS || 180),
    pollMs: Number(process.env.FAL_WAN_POLL_MS || 1500)
  };

  timer?.mark('fal wan submit attempt', {
    fields: Object.keys(payload),
    model: endpoint
  });
  const submission = await falJson(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  timer?.mark('fal wan submitted', { requestId: submission.request_id });
  const result = await waitForFalResult(submission, wanTimer);
  console.log('[tryon:wan] raw response array lengths', {
    images: Array.isArray(result?.images) ? result.images.length : undefined,
    output: Array.isArray(result?.output) ? result.output.length : undefined,
    data: Array.isArray(result?.data) ? result.data.length : undefined
  });
  console.log('[tryon:wan] raw response json', JSON.stringify(result, null, 2));
  const generatedUrl = firstGeneratedImageUrl(result);
  if (!generatedUrl) throw new Error(`FAL Wan returned no image. Response keys: ${Object.keys(result || {}).join(', ')}`);
  const { bytes, mimetype } = await generatedBytesFromUrl(generatedUrl, timer);
  timer?.mark('wan generated image downloaded', { outputKb: Math.round(bytes.length / 1024) });
  return {
    bytes,
    mimetype,
    prompt: finalPrompt,
    model: endpoint,
    quality: 'wan v2.6 image-to-image'
  };
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
  const generated = selectedModel === 'wan-v2.6-image-to-image'
    ? await callFalWanImageToImage({ user, product, timer })
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

async function replaceGeneratedTryOn({ user, product, tryOnModel, timer }) {
  const selectedModel = normalizeTryOnModel(tryOnModel);
  timer?.mark('try-on override model selected', { selectedModel });
  const generated = selectedModel === 'wan-v2.6-image-to-image'
    ? await callFalWanImageToImage({ user, product, timer })
    : {
        ...(await callFalImageEdit({ user, product, timer })),
        mimetype: 'image/png',
        model: imageModel(),
        quality: imageQuality()
      };
  const filename = `tryon-${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFor(generated.mimetype)}`;
  const image = await saveUserCacheFile({ user, bytes: generated.bytes, filename, mimetype: generated.mimetype });
  timer?.mark('generated image replaced', { path: image.path });

  return TryOn.findOneAndUpdate(
    { user: user._id, product: product._id },
    {
      $set: {
        provider: 'fal',
        model: generated.model,
        quality: generated.quality,
        prompt: generated.prompt,
        tokenCost: chargedTokenCost(user),
        image
      },
      $setOnInsert: {
        user: user._id,
        product: product._id
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
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
  const generated = selectedModel === 'wan-v2.6-image-to-image'
    ? await callFalWanImageToImage({ user, product, timer })
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
  const selectedModel = normalizeTryOnModel(tryOnModel);
  timer?.mark('custom try-on model selected', { selectedModel });
  const minReferenceSize = selectedModel === 'wan-v2.6-image-to-image' ? 384 : 0;
  const garmentDataUri = dataUriFromBuffer(garmentFile, 'garment', { minWidth: minReferenceSize, minHeight: minReferenceSize });
  timer?.mark('custom garment prepared', { garmentKb: Math.round(garmentDataUri.length / 1024) });
  const generated = selectedModel === 'wan-v2.6-image-to-image'
    ? await callFalWanImageToImage({
        user,
        garmentDataUri,
        prompt: wanCustomTryOnPrompt(),
        timer
      })
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

  const compatibility = wearableCompatibility(product);
  if (!compatibility.compatible) {
    return res.status(400).json({ message: compatibility.reason });
  }
  const genderMatch = genderCompatibility(product, req.user.genderPreference);
  if (!genderMatch.compatible) {
    return res.status(400).json({ message: genderMatch.reason });
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
  const requestedModel = normalizeTryOnModel(req.body?.tryOnModel);
  const hasRequestedModel = Boolean(req.body?.tryOnModel);
  const forceGenerate = Boolean(req.body?.force || req.body?.refresh);
  const timer = createTimer('generate', {
    userId: req.user._id.toString(),
    productId: req.params.productId,
    requestedModel: req.body?.tryOnModel || '',
    forceGenerate
  });
  let reserved = false;

  try {
    const product = await Product.findOne({ _id: req.params.productId, isActive: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const existing = await TryOn.findOne({ user: req.user._id, product: req.params.productId });
    const selectedModel = hasRequestedModel
      ? requestedModel
      : forceGenerate && existing?.model
        ? normalizeTryOnModel(existing.model)
        : tryOnModelForProduct(product);
    timer.mark('product loaded', {
      tryOnModel: selectedModel,
      existingModel: existing?.model || ''
    });

    if (existing && !forceGenerate) {
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

    const tryOn = forceGenerate
      ? await replaceGeneratedTryOn({ user: req.user, product, tryOnModel: selectedModel, timer })
      : await saveGeneratedTryOn({ user: req.user, product, timer });
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
