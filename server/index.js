import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import tryOnRoutes from './routes/tryons.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5050;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(rootDir, 'uploads')));
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/tryons', tryOnRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

async function start() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing. Add it to .env before starting the server.');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB || 'fitlook'
  });

  app.listen(port, () => {
    console.log(`FitLook API running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
