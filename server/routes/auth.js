import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'node:path';
import User from '../models/User.js';
import { normalizeGenderPreference } from '../utils/genderPreference.js';

const router = express.Router();
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
    cb(null, file.mimetype.startsWith('image/'));
  }
});

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
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      username,
      genderPreference,
      passwordHash,
      devMode: parseBoolean(req.body.devMode),
      bodyPhoto: {
        filename: req.file.filename,
        path: `uploads/${req.file.filename}`,
        mimetype: req.file.mimetype,
        size: req.file.size
      }
    });

    res.status(201).json({ token: sign(user), user: user.toClient() });
  } catch (error) {
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

router.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user.toClient() });
});

router.patch('/dev-mode', requireUser, async (req, res) => {
  req.user.devMode = parseBoolean(req.body?.devMode);
  await req.user.save();
  res.json({ user: req.user.toClient() });
});

router.patch('/gender-preference', requireUser, async (req, res) => {
  const genderPreference = normalizeGenderPreference(req.body?.genderPreference);
  if (!genderPreference) return res.status(400).json({ message: 'Choose male, female, or other' });
  req.user.genderPreference = genderPreference;
  await req.user.save();
  res.json({ user: req.user.toClient() });
});

router.post('/body-photo', requireUser, upload.single('bodyPhoto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload a profile photo first' });
  req.user.bodyPhoto = {
    filename: req.file.filename,
    path: `uploads/${req.file.filename}`,
    mimetype: req.file.mimetype,
    size: req.file.size
  };
  await req.user.save();
  res.json({ user: req.user.toClient() });
});

export default router;
export { requireUser };
