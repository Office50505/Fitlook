import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'node:path';
import User from '../models/User.js';

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
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email, and password are required' });
  if (!req.file) return res.status(400).json({ message: 'Full-body photo is required' });

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ message: 'An account already exists for this email' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    name,
    email,
    passwordHash,
    bodyPhoto: {
      filename: req.file.filename,
      path: `uploads/${req.file.filename}`,
      mimetype: req.file.mimetype,
      size: req.file.size
    }
  });

  res.status(201).json({ token: sign(user), user: user.toClient() });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return res.status(401).json({ message: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Invalid email or password' });
  res.json({ token: sign(user), user: user.toClient() });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user.toClient() });
});

export default router;
export { requireUser };
