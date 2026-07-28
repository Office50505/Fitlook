import bcrypt from 'bcryptjs';
import express from 'express';
import heicConvert from 'heic-convert';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import AdminAuditLog from '../models/AdminAuditLog.js';
import TokenOrder from '../models/TokenOrder.js';
import User from '../models/User.js';
import { recordAdminAudit } from '../utils/adminAudit.js';
import { isAllowedAdminEmail, normalizeEmail, requireAdmin, signAdminSession } from '../utils/adminAccess.js';
import { normalizeGenderPreference } from '../utils/genderPreference.js';

const router = express.Router();
const avifExtensions = new Set(['.avif']);
const avifMimeTypes = new Set(['image/avif', 'image/x-avif']);
const heicExtensions = new Set(['.heic', '.heif']);
const heicMimeTypes = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

function profileImageModel() {
  return process.env.FAL_PROFILE_IMAGE_MODEL || process.env.FAL_TRYON_MODEL || 'openai/gpt-image-2/edit';
}

function shouldGenerateFullBodyProfile() {
  return !['0', 'false', 'no', 'off'].includes(String(process.env.PROFILE_FULL_BODY_GENERATION ?? 'true').toLowerCase());
}

function shouldGenerateFullBodyProfileForRequest(req) {
  const mode = String(req.body?.profilePhotoMode || 'ai-full-body').toLowerCase();
  return shouldGenerateFullBodyProfile() && mode !== 'exact';
}

function extensionForFile(file) {
  return path.extname(file.originalname || file.filename || '').toLowerCase();
}

function extensionForMimetype(mimetype) {
  if (mimetype?.includes('png')) return '.png';
  if (mimetype?.includes('webp')) return '.webp';
  if (mimetype?.includes('gif')) return '.gif';
  return '.jpg';
}

function imageMimeTypeFromBuffer(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return '';
  if (bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.toString('ascii', 4, 12) === 'ftypavif') return 'image/avif';
  return '';
}

function imageMimeTypeFromResponse(response, bytes) {
  const declared = response.headers.get('content-type') || '';
  if (declared.startsWith('image/')) return declared.split(';')[0];
  return imageMimeTypeFromBuffer(bytes) || declared || 'image/png';
}

function isHeicUpload(file) {
  return heicMimeTypes.has(String(file.mimetype || '').toLowerCase()) || heicExtensions.has(extensionForFile(file));
}

function isAvifUpload(file) {
  return avifMimeTypes.has(String(file.mimetype || '').toLowerCase()) || avifExtensions.has(extensionForFile(file));
}

function isAvifBuffer(bytes) {
  return imageMimeTypeFromBuffer(bytes) === 'image/avif';
}

function isAllowedImageUpload(file) {
  return String(file.mimetype || '').startsWith('image/') || isHeicUpload(file) || isAvifUpload(file);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAllowedImageUpload(file));
  }
});

function readableProviderError(value, fallback = 'Profile image generation failed') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || fallback;
  if (Array.isArray(value)) return value.map((item) => readableProviderError(item, fallback)).filter(Boolean).join(' ') || fallback;
  if (typeof value === 'object') {
    const nested = value.message || value.detail || value.error || value.errors;
    if (nested && nested !== value) return readableProviderError(nested, fallback);
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
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
  if (!response.ok) throw new Error(readableProviderError(data.detail || data.error || data.message || data, 'FAL profile image request failed'));
  return data;
}

async function waitForFalProfileResult(submission) {
  const statusUrl = submission.status_url;
  const responseUrl = submission.response_url;
  if (!statusUrl || !responseUrl) throw new Error('FAL did not return queue URLs');

  const maxAttempts = Number(process.env.FAL_PROFILE_POLL_ATTEMPTS || 120);
  const pollMs = Number(process.env.FAL_PROFILE_POLL_MS || 1500);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await falJson(statusUrl);
    if (status.status === 'COMPLETED') return falJson(responseUrl);
    if (status.status === 'FAILED' || status.error) throw new Error(readableProviderError(status.error || status, 'FAL profile image generation failed'));
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`FAL profile image generation timed out after ${Math.round((maxAttempts * pollMs) / 1000)} seconds`);
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

async function generatedBytesFromUrl(url) {
  if (/^data:image\//i.test(url)) {
    const [, metadata = '', base64 = ''] = url.match(/^data:([^;]+);base64,(.+)$/i) || [];
    if (!base64) throw new Error('Generated profile image data URI was invalid');
    const bytes = Buffer.from(base64, 'base64');
    return { bytes, mimetype: metadata || imageMimeTypeFromBuffer(bytes) || 'image/png' };
  }

  const response = await fetch(url, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 FitLook profile image fetcher'
    }
  });
  if (!response.ok) throw new Error('Could not download generated profile image');
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, mimetype: imageMimeTypeFromResponse(response, bytes) };
}

function fullBodyProfilePrompt() {
  return [
"Create one photorealistic, full-body, head-to-toe ecommerce body reference image using the uploaded person as the only identity source. This image will be used for a virtual clothing try-on app.",
"ABSOLUTE FACE RULE: The face must be treated as fixed reference data, not something to regenerate or interpret. Do not redesign, beautify, smooth, slim, age, de-age, re-face, symmetrize, or in any way 'improve' the face. Preserve exactly: face shape, eye shape, eyelid type, eye spacing, gaze direction, eyebrow shape, nose shape, lip shape, natural (unforced) expression, jawline, chin, cheekbones, ears, hairline, hairstyle, hair color and texture, natural skin tone, and visible skin texture including pores and any marks, moles, freckles, or asymmetries. The generated face must be instantly and unmistakably recognizable as the exact same person from the uploaded image, not a smoothed or idealized version of them.",
"IDENTITY PRIORITY OVER POSE: Do not insvent a new perfectly front-facing version of the face. If the uploaded face is tilted, angled, three-quarter, or slightly turned, preserve that exact same head angle, facial structure, eye shape, eyelids, and natural head character from the uploaded photo. The body should become a clean catalog standing pose, but the head and face must retain their original angle and character even if it creates slight asymmetry with the body. Exact identity, skin texture, and expression preservation are more important than perfect pose symmetry or a 'cleaner' looking face.",
"BODY & POSE: Exactly one person, complete full body visible from top of head to soles of feet. Straight, relaxed standing pose, body mostly squared to the camera, arms relaxed at the sides, both hands and all fingers visible and anatomically correct, feet slightly apart, weight evenly balanced. If the reference is a selfie, cropped portrait, or half-body photo, infer only the missing body below the visible region, consistent with the person's visible build, apparent age, and skin tone — the body may be inferred, but the face must never be altered or reinterpreted to accommodate this. No cropping at the head, shoulders, arms, hands, waist, hips, knees, ankles, or feet.",
"REALISM REQUIREMENTS: The image must look like a real photograph taken in a studio, not a CGI render, 3D model, or AI-smoothed image. Retain natural skin texture (visible pores, natural texture variation) rather than plastic or waxy-looking skin. Render fabric with realistic folds, weight, and drape rather than a flat painted-on look. Maintain anatomically correct proportions and natural joint positions. Sharp focus throughout the image, no soft-focus or glamour-style blur.",
"CLOTHING & SCENE: Simple fitted neutral clothing: plain fitted t-shirt and plain fitted pants in solid neutral colors, plain simple shoes. Clean even studio lighting, soft natural shadows, sharp focus, realistic true-to-life skin rendering. Plain seamless neutral background, light gray or off-white.",
"DO NOT: Do not modify, beautify, smooth, or reinterpret the face, eyes, eyelids, eyebrows, expression, smile, hairstyle, skin tone, skin texture, or identity in any way. Do not add logos, text, watermarks, accessories, jewelry, hats, sunglasses, bags, or props. No extra people, mirrors, reflections, or duplicated or extra limbs. No stylization, cartoon, illustration, CGI look, or beauty filters. Output must be photorealistic, modest, non-sexualized, and suitable as an ecommerce body reference."  
  ].join(' ');
}

async function generateFullBodyProfilePhoto(file) {
  if (!shouldGenerateFullBodyProfile()) return file;

  const inputBuffer = await fs.readFile(file.path);
  const inputDataUri = `data:${file.mimetype || 'image/jpeg'};base64,${inputBuffer.toString('base64')}`;
  const model = profileImageModel();
  const submission = await falJson(`https://queue.fal.run/${model}`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: fullBodyProfilePrompt(),
      image_urls: [inputDataUri],
      image_size: { width: 1024, height: 1536 },
      quality: process.env.FAL_PROFILE_IMAGE_QUALITY || process.env.FAL_IMAGE_QUALITY || 'low',
      num_images: 1,
      output_format: 'png'
    })
  });
  const result = await waitForFalProfileResult(submission);
  const generatedUrl = firstGeneratedImageUrl(result);
  if (!generatedUrl) throw new Error('FAL did not return a generated full-body profile image');

  const { bytes, mimetype } = await generatedBytesFromUrl(generatedUrl);
  const filename = `profile-fullbody-${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionForMimetype(mimetype)}`;
  const outputPath = path.join(path.dirname(file.path), filename);
  await fs.writeFile(outputPath, bytes);

  return {
    ...file,
    filename,
    path: outputPath,
    mimetype,
    size: bytes.length
  };
}

function isBodyPhotoPreparationError(error) {
  const message = error?.message || '';
  return message.includes('HEIC/HEIF') || /FAL|profile image|full-body profile/i.test(message);
}

async function normalizeBodyPhotoUpload(file) {
  if (!file || (!isHeicUpload(file) && !isAvifUpload(file))) return file;

  const inputPath = file.path;
  const parsed = path.parse(file.filename);
  const filename = `${parsed.name}.jpg`;
  const outputPath = path.join(path.dirname(inputPath), filename);

  try {
    const inputBuffer = await fs.readFile(inputPath);
    const outputBuffer = isAvifUpload(file) || isAvifBuffer(inputBuffer)
      ? await sharp(inputBuffer).jpeg({ quality: 90 }).toBuffer()
      : Buffer.from(await heicConvert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.9
      }));

    await fs.writeFile(outputPath, outputBuffer);
    await fs.unlink(inputPath).catch(() => {});
    const stats = await fs.stat(outputPath);
    return {
      ...file,
      filename,
      path: outputPath,
      mimetype: 'image/jpeg',
      size: stats.size
    };
  } catch (error) {
    await fs.unlink(outputPath).catch(() => {});
    throw new Error('Could not convert the AVIF/HEIC/HEIF profile photo. Please try another image.');
  }
}

async function bodyPhotoFromUpload(file, { generateFullBody = true } = {}) {
  const normalized = await normalizeBodyPhotoUpload(file);
  return {
    filename: normalized.filename,
    path: `uploads/${normalized.filename}`,
    mimetype: normalized.mimetype,
    size: normalized.size,
    status: generateFullBody ? 'generating' : 'ready',
    source: generateFullBody ? 'upload' : 'exact-upload'
  };
}

function localFileFromBodyPhoto(bodyPhoto) {
  return {
    filename: bodyPhoto.filename,
    path: bodyPhoto.path,
    mimetype: bodyPhoto.mimetype,
    size: bodyPhoto.size
  };
}

async function generateFullBodyProfileInBackground(userId, sourceBodyPhoto, { enabled = true } = {}) {
  if (!enabled || !shouldGenerateFullBodyProfile()) return;

  setImmediate(async () => {
    try {
      console.log('[profile-fullbody] start', { userId: userId.toString(), source: sourceBodyPhoto.path });
      const generated = await generateFullBodyProfilePhoto(localFileFromBodyPhoto(sourceBodyPhoto));
      const generatedBodyPhoto = {
        filename: generated.filename,
        path: `uploads/${generated.filename}`,
        mimetype: generated.mimetype,
        size: generated.size,
        status: 'ready',
        source: 'fal-full-body',
        generatedAt: new Date()
      };

      const updated = await User.findOneAndUpdate(
        { _id: userId, 'bodyPhoto.path': sourceBodyPhoto.path },
        { $set: { bodyPhoto: generatedBodyPhoto } },
        { new: true }
      );

      if (updated) {
        await fs.unlink(sourceBodyPhoto.path).catch(() => {});
        console.log('[profile-fullbody] done', { userId: userId.toString(), path: generatedBodyPhoto.path });
      } else {
        await fs.unlink(generated.path).catch(() => {});
        console.log('[profile-fullbody] skipped stale result', { userId: userId.toString() });
      }
    } catch (error) {
      const message = readableProviderError(error, 'Could not generate full-body profile image');
      await User.findOneAndUpdate(
        { _id: userId, 'bodyPhoto.path': sourceBodyPhoto.path },
        { $set: { 'bodyPhoto.status': 'failed', 'bodyPhoto.error': message } }
      );
      console.error('[profile-fullbody] failed', { userId: userId.toString(), error: message });
    }
  });
}

function sign(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '14d' });
}

function normalizeUsername(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function usernameFromName(value = '') {
  return normalizeUsername(
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
}

async function uniqueUsername(seed) {
  const base = usernameFromName(seed) || 'fitlook_user';
  for (let index = 0; index < 20; index += 1) {
    const candidate = index === 0 ? base : `${base}${Math.floor(100 + Math.random() * 9000)}`;
    const existing = await User.exists({ username: candidate });
    if (!existing) return candidate;
  }
  return `${base}${Date.now().toString().slice(-6)}`;
}

async function requireUser(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.sub);
    if (!user) return res.status(401).json({ message: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session' });
  }
}

router.post('/signup', upload.single('bodyPhoto'), async (req, res) => {
  const { name, email, password } = req.body;
  const username = normalizeUsername(req.body.username) || await uniqueUsername(name);
  const genderPreference = normalizeGenderPreference(req.body.genderPreference);
  if (!name || !email || !password || !username || !genderPreference) return res.status(400).json({ message: 'Name, username, email, gender preference, and password are required' });
  if (username.length < 3) return res.status(400).json({ message: 'Username must be at least 3 characters' });
  if (!req.file) return res.status(400).json({ message: 'Full-body photo is required' });

  const existing = await User.findOne({
    $or: [
      { email: email.toLowerCase() },
      { username }
    ]
  });
  if (existing?.email === email.toLowerCase()) return res.status(409).json({ message: 'An account already exists for this email' });
  if (existing?.username === username) return res.status(409).json({ message: 'This username is already taken' });

  try {
    const generateFullBody = shouldGenerateFullBodyProfileForRequest(req);
    const bodyPhoto = await bodyPhotoFromUpload(req.file, { generateFullBody });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      username,
      genderPreference,
      passwordHash,
      devMode: parseBoolean(req.body.devMode),
      bodyPhoto
    });

    generateFullBodyProfileInBackground(user._id, bodyPhoto, { enabled: generateFullBody });
    res.status(201).json({ token: sign(user), user: user.toClient() });
  } catch (error) {
    if (isBodyPhotoPreparationError(error)) return res.status(400).json({ message: error.message });
    if (error.code === 11000 && error.keyPattern?.username) return res.status(409).json({ message: 'This username is already taken' });
    if (error.code === 11000 && error.keyPattern?.email) return res.status(409).json({ message: 'An account already exists for this email' });
    throw error;
  }
});

router.get('/username-suggestions', async (req, res) => {
  const base = usernameFromName(req.query.name) || 'fitlook_user';
  const suggestions = [];
  for (let index = 0; suggestions.length < 4 && index < 20; index += 1) {
    const candidate = index === 0 ? base : `${base}${Math.floor(100 + Math.random() * 9000)}`;
    const existing = await User.exists({ username: candidate });
    if (!existing && !suggestions.includes(candidate)) suggestions.push(candidate);
  }
  res.json({ suggestions });
});

router.post('/login', async (req, res) => {
  const identifier = String(req.body.email || req.body.username || '').trim().toLowerCase();
  const { password } = req.body;
  if (!identifier || !password) return res.status(400).json({ message: 'Email or username and password are required' });
  const user = await User.findOne({
    $or: [
      { email: identifier },
      { username: normalizeUsername(identifier) }
    ]
  });
  if (!user) return res.status(401).json({ message: 'Invalid email/username or password' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Invalid email/username or password' });
  res.json({ token: sign(user), user: user.toClient() });
});

router.post('/admin-login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const adminKey = String(req.body?.adminKey || '');
  if (!email || !adminKey) return res.status(400).json({ message: 'Gmail and admin key are required' });
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ message: 'Invalid admin key' });
  if (!await isAllowedAdminEmail(email)) return res.status(403).json({ message: 'This Gmail is not allowed for admin access' });
  const token = await signAdminSession(email);
  res.json({ token, admin: { email } });
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 150);
  const filter = q ? {
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { username: { $regex: q, $options: 'i' } }
    ]
  } : {};

  const users = await User.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  const userIds = users.map((user) => user._id);
  const orders = await TokenOrder.find({ user: { $in: userIds } }).sort({ createdAt: -1 }).lean();
  const latestOrderByUser = new Map();
  orders.forEach((order) => {
    const key = String(order.user);
    if (!latestOrderByUser.has(key)) latestOrderByUser.set(key, order);
  });

  const [totalUsers, tokenTotal] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: null, total: { $sum: '$tokens' } } }])
  ]);

  res.json({
    users: users.map((user) => {
      const lastOrder = latestOrderByUser.get(String(user._id));
      return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        username: user.username,
        tokens: user.tokens || 0,
        devMode: Boolean(user.devMode),
        subscription: {
          planId: user.subscription?.planId || null,
          status: user.subscription?.status || 'none',
          tokensPerMonth: user.subscription?.tokensPerMonth || 0,
          currentPeriodStart: user.subscription?.currentPeriodStart || null,
          currentPeriodEnd: user.subscription?.currentPeriodEnd || null
        },
        bodyPhotoStatus: user.bodyPhoto?.status || 'uploaded',
        joinedAt: user.createdAt,
        lastOrder: lastOrder ? {
          id: String(lastOrder._id),
          planName: lastOrder.planName,
          tokens: lastOrder.tokens,
          amount: lastOrder.amount,
          currency: lastOrder.currency,
          status: lastOrder.status,
          createdAt: lastOrder.createdAt
        } : null
      };
    }),
    totals: {
      users: totalUsers,
      loaded: users.length,
      tokens: tokenTotal[0]?.total || 0
    }
  });
});

router.get('/admin/operations', requireAdmin, async (_req, res) => {
  const [orders, orderTotals, auditLogs] = await Promise.all([
    TokenOrder.find({}).sort({ createdAt: -1 }).limit(12).populate('user', 'name email username').lean(),
    TokenOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, tokens: { $sum: '$tokens' }, amount: { $sum: '$amount' } } }]),
    AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(20).lean()
  ]);

  res.json({
    orders: orders.map((order) => ({
      id: String(order._id),
      merchantOrderId: order.merchantOrderId,
      planName: order.planName,
      tokens: order.tokens,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt,
      creditedAt: order.creditedAt,
      user: order.user ? {
        id: String(order.user._id),
        name: order.user.name,
        email: order.user.email,
        username: order.user.username
      } : null
    })),
    orderTotals: orderTotals.reduce((acc, item) => {
      acc[item._id || 'unknown'] = { count: item.count || 0, tokens: item.tokens || 0, amount: item.amount || 0 };
      return acc;
    }, {}),
    auditLogs: auditLogs.map((log) => ({
      id: String(log._id),
      actorEmail: log.actorEmail,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      label: log.label,
      detail: log.detail,
      createdAt: log.createdAt
    }))
  });
});

router.patch('/admin/users/:id/tokens', requireAdmin, async (req, res) => {
  const mode = String(req.body?.mode || 'set').toLowerCase();
  const amount = Number(req.body?.amount);
  if (!['set', 'add'].includes(mode)) return res.status(400).json({ message: 'Token mode must be set or add' });
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) return res.status(400).json({ message: 'Token amount must be a whole number' });
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'Invalid user id' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const nextTokens = mode === 'add' ? Number(user.tokens || 0) + amount : amount;
  const previousTokens = Number(user.tokens || 0);
  user.tokens = Math.max(0, nextTokens);
  await user.save();
  await recordAdminAudit(req, {
    action: mode === 'add' ? 'tokens_added' : 'tokens_set',
    entityType: 'user',
    entityId: user._id.toString(),
    label: user.email,
    detail: { amount, previousTokens, nextTokens: user.tokens }
  });

  res.json({
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      username: user.username,
      tokens: user.tokens,
      subscription: user.subscription,
      devMode: Boolean(user.devMode),
      joinedAt: user.createdAt,
      bodyPhotoStatus: user.bodyPhoto?.status || 'uploaded'
    }
  });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user.toClient() });
});

router.patch('/dev-mode', requireUser, async (req, res) => {
  req.user.devMode = parseBoolean(req.body?.devMode);
  await req.user.save();
  res.json({ user: req.user.toClient() });
});

router.post('/body-photo', requireUser, upload.single('bodyPhoto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload a profile photo first' });
  try {
    const generateFullBody = shouldGenerateFullBodyProfileForRequest(req);
    const bodyPhoto = await bodyPhotoFromUpload(req.file, { generateFullBody });
    req.user.bodyPhoto = bodyPhoto;
    await req.user.save();
    generateFullBodyProfileInBackground(req.user._id, bodyPhoto, { enabled: generateFullBody });
    res.json({ user: req.user.toClient() });
  } catch (error) {
    if (isBodyPhotoPreparationError(error)) return res.status(400).json({ message: error.message });
    throw error;
  }
});

export default router;
export { requireUser };
