import mongoose from 'mongoose';
import ClosetItem from '../models/ClosetItem.js';
import ClosetOutfit from '../models/ClosetOutfit.js';
import CustomTryOn from '../models/CustomTryOn.js';
import ExternalTryOn from '../models/ExternalTryOn.js';
import Product from '../models/Product.js';
import TryOn from '../models/TryOn.js';
import User from '../models/User.js';
import { useBunny } from '../utils/storage.js';

const mediaSources = [
  { group: 'profile', Model: User, field: 'bodyPhoto', userField: '_id' },
  { group: 'profile', Model: User, field: 'bodyPhoto.original', userField: '_id' },
  { group: 'tryon', Model: TryOn, field: 'image' },
  { group: 'tryon', Model: TryOn, field: 'transparentImage' },
  { group: 'tryon', Model: CustomTryOn, field: 'image' },
  { group: 'tryon', Model: CustomTryOn, field: 'transparentImage' },
  { group: 'tryon', Model: ExternalTryOn, field: 'image' },
  { group: 'tryon', Model: ExternalTryOn, field: 'transparentImage' },
  { group: 'tryon', Model: ClosetOutfit, field: 'image' },
  { group: 'tryon', Model: ClosetOutfit, field: 'transparentImage' },
  { group: 'closet', Model: CustomTryOn, field: 'garment' },
  { group: 'closet', Model: ClosetOutfit, field: 'garment' },
  { group: 'closet', Model: ClosetItem, field: 'image' },
  { group: 'product', Model: Product, field: 'image', userField: null }
];

function storedFieldClause(field) {
  return {
    $or: [
      { [`${field}.path`]: { $type: 'string', $ne: '' } },
      { [`${field}.storage`]: { $in: ['bunny', 'local'] } }
    ]
  };
}

function withTotal(values) {
  return { ...values, all: Object.values(values).reduce((total, value) => total + Number(value || 0), 0) };
}

async function adminMediaUsage(userId = '') {
  const counts = { profile: 0, tryon: 0, closet: 0, product: 0 };
  const bytes = { profile: 0, tryon: 0, closet: 0, product: 0 };
  const bunnyBytes = { profile: 0, tryon: 0, closet: 0, product: 0 };
  const bunnyCounts = { profile: 0, tryon: 0, closet: 0, product: 0 };
  const unknownSize = { profile: 0, tryon: 0, closet: 0, product: 0 };
  const results = await Promise.all(mediaSources.map(async (source) => {
    const userField = source.userField === null ? null : (source.userField || 'user');
    if (userId && !userField) return { group: source.group, count: 0, bytes: 0, bunnyBytes: 0, bunnyCount: 0, unknownSize: 0 };
    const clauses = [storedFieldClause(source.field)];
    if (userId) clauses.push({ [userField]: new mongoose.Types.ObjectId(userId) });
    const sizeField = `$${source.field}.size`;
    const storageField = `$${source.field}.storage`;
    const pathField = `$${source.field}.path`;
    const bunnyFile = useBunny()
      ? {
          $or: [
            { $eq: [storageField, 'bunny'] },
            {
              $and: [
                { $eq: [{ $ifNull: [storageField, ''] }, ''] },
                { $ne: [{ $ifNull: [pathField, ''] }, ''] }
              ]
            }
          ]
        }
      : { $eq: [storageField, 'bunny'] };
    const [result] = await source.Model.aggregate([
      { $match: clauses.length === 1 ? clauses[0] : { $and: clauses } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          bytes: { $sum: { $ifNull: [sizeField, 0] } },
          bunnyBytes: { $sum: { $cond: [bunnyFile, { $ifNull: [sizeField, 0] }, 0] } },
          bunnyCount: { $sum: { $cond: [bunnyFile, 1, 0] } },
          unknownSize: { $sum: { $cond: [{ $gt: [{ $ifNull: [sizeField, 0] }, 0] }, 0, 1] } }
        }
      }
    ]);
    return {
      group: source.group,
      count: Number(result?.count || 0),
      bytes: Number(result?.bytes || 0),
      bunnyBytes: Number(result?.bunnyBytes || 0),
      bunnyCount: Number(result?.bunnyCount || 0),
      unknownSize: Number(result?.unknownSize || 0)
    };
  }));

  results.forEach((result) => {
    counts[result.group] += result.count;
    bytes[result.group] += result.bytes;
    bunnyBytes[result.group] += result.bunnyBytes;
    bunnyCounts[result.group] += result.bunnyCount;
    unknownSize[result.group] += result.unknownSize;
  });

  return {
    counts: withTotal(counts),
    usage: {
      bytes: withTotal(bytes),
      bunnyBytes: withTotal(bunnyBytes),
      bunnyCounts: withTotal(bunnyCounts),
      unknownSize: withTotal(unknownSize)
    }
  };
}

export { adminMediaUsage };
