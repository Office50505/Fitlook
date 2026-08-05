import dotenv from 'dotenv';
import mongoose from 'mongoose';
import AdminAuditLog from '../server/models/AdminAuditLog.js';
import ClosetItem from '../server/models/ClosetItem.js';
import ClosetOutfit from '../server/models/ClosetOutfit.js';
import CustomTryOn from '../server/models/CustomTryOn.js';
import ExternalTryOn from '../server/models/ExternalTryOn.js';
import Product from '../server/models/Product.js';
import TokenOrder from '../server/models/TokenOrder.js';
import TryOn from '../server/models/TryOn.js';
import User from '../server/models/User.js';
import UserEvent from '../server/models/UserEvent.js';
import UserPreference from '../server/models/UserPreference.js';

dotenv.config();

const models = [
  AdminAuditLog,
  ClosetItem,
  ClosetOutfit,
  CustomTryOn,
  ExternalTryOn,
  Product,
  TokenOrder,
  TryOn,
  User,
  UserEvent,
  UserPreference
];

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing. Set it before running index creation.');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB || 'fitlook'
  });

  for (const model of models) {
    console.log(`[indexes] creating indexes for ${model.modelName}`);
    await model.createIndexes();
  }

  await mongoose.disconnect();
  console.log('[indexes] done');
}

main().catch(async (error) => {
  console.error('[indexes] failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
