import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const accessFile = path.resolve(__dirname, '../config/admin-access.json');

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

async function adminAccessConfig() {
  try {
    const raw = await fs.readFile(accessFile, 'utf8');
    const parsed = JSON.parse(raw);
    const allowedEmails = Array.isArray(parsed.allowedEmails) ? parsed.allowedEmails.map(normalizeEmail).filter(Boolean) : [];
    return { allowedEmails };
  } catch {
    return { allowedEmails: [] };
  }
}

async function isAllowedAdminEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const config = await adminAccessConfig();
  return config.allowedEmails.includes(normalized);
}

async function signAdminSession(email) {
  const normalized = normalizeEmail(email);
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is missing on the server');
  if (!await isAllowedAdminEmail(normalized)) throw new Error('This Gmail is not allowed for admin access');
  return jwt.sign({ scope: 'admin', email: normalized }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

async function verifyAdminSession(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.scope !== 'admin') return null;
    const email = normalizeEmail(decoded.email);
    if (!await isAllowedAdminEmail(email)) return null;
    return { email };
  } catch {
    return null;
  }
}

async function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(500).json({ message: 'ADMIN_KEY is missing on the server' });

  if (req.headers['x-admin-key'] === adminKey) return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = await verifyAdminSession(token);
  if (!session) return res.status(401).json({ message: 'Invalid admin session' });
  req.admin = session;
  return next();
}

export { accessFile, adminAccessConfig, isAllowedAdminEmail, normalizeEmail, requireAdmin, signAdminSession };
