import jwt from 'jsonwebtoken';

async function signAdminSession() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is missing on the server');
  return jwt.sign({ scope: 'admin', method: 'admin-key' }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

async function verifyAdminSession(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.scope !== 'admin') return null;
    return { method: decoded.method || 'admin-key' };
  } catch {
    return null;
  }
}

async function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(500).json({ message: 'ADMIN_KEY is missing on the server' });

  if (req.headers['x-admin-key'] === adminKey) {
    req.admin = { method: 'admin-key' };
    return next();
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = await verifyAdminSession(token);
  if (!session) return res.status(401).json({ message: 'Invalid admin session' });
  req.admin = session;
  return next();
}

export { requireAdmin, signAdminSession };
