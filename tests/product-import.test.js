import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  canonicalAmazonUrl,
  extractAsin,
  withAssociateTag
} from '../server/services/amazon-product-provider.js';
import {
  inferPlacement,
  importProducts,
  parseCsv,
  REPLACE_CONFIRMATION,
  validateAndBuildProduct
} from '../server/services/product-import.js';
import { temporaryExternalAmazonFilter } from '../server/routes/products.js';

const taxonomy = {
  batchSize: 2,
  genders: {
    men: { categories: ['T-Shirts', 'Jeans', 'Boxers'] },
    women: { categories: ['Dresses', 'Jeans', 'Bras'] }
  }
};

function validDraft(overrides = {}) {
  return {
    name: 'Acme Cotton T-Shirt',
    brand: 'Acme',
    category: 'T-Shirts',
    gender: 'men',
    price: 499,
    compareAtPrice: 799,
    currency: 'INR',
    rating: 4.2,
    ratingCount: 25,
    description: 'Cotton clothing garment for daily wear',
    tags: ['cotton'],
    remoteImageUrl: 'https://images.example.com/shirt.jpg',
    sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF12',
    affiliateLink: 'https://www.amazon.in/dp/B0ABCDEF12?tag=stampmybrand-21',
    sourceProvider: 'amazon',
    sourceProductId: 'B0ABCDEF12',
    ...overrides
  };
}

function fakeModel(existing = null) {
  const calls = { bulkWrite: [], updateMany: [] };
  return {
    calls,
    findOne() {
      return { lean: async () => existing };
    },
    async bulkWrite(operations) {
      calls.bulkWrite.push(operations);
      return { upsertedIds: { 0: 'new-product-id' } };
    },
    async updateMany(filter, update) {
      calls.updateMany.push({ filter, update });
      return { modifiedCount: 3 };
    }
  };
}

test('extracts ASIN and builds canonical affiliate URL', () => {
  const url = 'https://www.amazon.in/Some-Product/dp/B0ABCDEF12/ref=sxin?tag=old-tag';
  assert.equal(extractAsin(url), 'B0ABCDEF12');
  assert.equal(canonicalAmazonUrl(url), 'https://www.amazon.in/dp/B0ABCDEF12');
  assert.equal(withAssociateTag(url), 'https://www.amazon.in/dp/B0ABCDEF12?tag=stampmybrand-21');
});

test('parses quoted CSV manifest rows', () => {
  const rows = parseCsv('sourceUrl,tags\nhttps://www.amazon.in/dp/B0ABCDEF12,"cotton, casual"\n');
  assert.deepEqual(rows, [{ sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF12', tags: 'cotton, casual' }]);
});

test('validates clothing and rejects duplicate ASINs', () => {
  const context = { taxonomy, seenAsins: new Set(), batchId: 'batch-1' };
  const product = validateAndBuildProduct(validDraft(), { expectedGender: 'men', expectedCategory: 'T-Shirts' }, context);
  assert.equal(product.sourceProductId, 'B0ABCDEF12');
  assert.throws(
    () => validateAndBuildProduct(validDraft(), { expectedGender: 'men', expectedCategory: 'T-Shirts' }, context),
    /Duplicate ASIN/
  );
});

test('rejects accessories and invalid gender/category pairs', () => {
  assert.throws(
    () => validateAndBuildProduct(validDraft({
      name: 'Acme Leather Wallet',
      description: 'wallet accessory',
      tags: ['wallet']
    }), { expectedGender: 'men', expectedCategory: 'T-Shirts' }, { taxonomy, seenAsins: new Set() }),
    /Accessory/
  );

  assert.throws(
    () => validateAndBuildProduct(validDraft({ category: 'Boxers', gender: 'women' }), { expectedGender: 'women', expectedCategory: 'Boxers' }, { taxonomy, seenAsins: new Set() }),
    /Category/
  );
});

test('classifies garment placement', () => {
  assert.equal(inferPlacement({ category: 'Jeans', name: 'Blue jeans' }), 'bottom');
  assert.equal(inferPlacement({ category: 'T-Shirts', name: 'Crew neck tee' }), 'top');
});

test('dry-run performs zero writes and enforces per-category limit', async () => {
  const reportsDir = await mkdtemp(path.join(os.tmpdir(), 'fitlook-import-'));
  const model = fakeModel();
  const entries = [
    { sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF10', expectedGender: 'men', expectedCategory: 'T-Shirts' },
    { sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF11', expectedGender: 'men', expectedCategory: 'T-Shirts' },
    { sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF12', expectedGender: 'men', expectedCategory: 'T-Shirts' }
  ];
  const provider = {
    async getProduct(entry) {
      const asin = extractAsin(entry.sourceUrl);
      return validDraft({ sourceProductId: asin, sourceUrl: entry.sourceUrl, affiliateLink: withAssociateTag(entry.sourceUrl) });
    }
  };

  const { report } = await importProducts({ entries, taxonomy, productProvider: provider, productModel: model, reportsDir });
  assert.equal(report.inserted, 2);
  assert.equal(report.skipped, 1);
  assert.equal(model.calls.bulkWrite.length, 0);
});

test('commit upserts products directly through bulkWrite', async () => {
  const reportsDir = await mkdtemp(path.join(os.tmpdir(), 'fitlook-import-'));
  const model = fakeModel();
  const provider = { async getProduct() { return validDraft(); } };
  const { report } = await importProducts({
    entries: [{ sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF12', expectedGender: 'men', expectedCategory: 'T-Shirts' }],
    taxonomy,
    productProvider: provider,
    productModel: model,
    reportsDir,
    commit: true
  });

  assert.equal(report.inserted, 1);
  assert.equal(model.calls.bulkWrite.length, 1);
  assert.equal(model.calls.bulkWrite[0][0].updateOne.upsert, true);
});

test('replace-existing requires explicit confirmation and deactivates old products after commit', async () => {
  const reportsDir = await mkdtemp(path.join(os.tmpdir(), 'fitlook-import-'));
  const provider = { async getProduct() { return validDraft(); } };
  await assert.rejects(
    importProducts({
      entries: [{ sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF12', expectedGender: 'men', expectedCategory: 'T-Shirts' }],
      taxonomy,
      productProvider: provider,
      productModel: fakeModel(),
      reportsDir,
      commit: true,
      replaceExisting: true
    }),
    /REPLACE_ACTIVE_CATALOG/
  );

  const model = fakeModel();
  const { report } = await importProducts({
    entries: [{ sourceUrl: 'https://www.amazon.in/dp/B0ABCDEF12', expectedGender: 'men', expectedCategory: 'T-Shirts' }],
    taxonomy,
    productProvider: provider,
    productModel: model,
    reportsDir,
    commit: true,
    replaceExisting: true,
    confirm: REPLACE_CONFIRMATION
  });

  assert.equal(report.oldProductsDeactivated[0].count, 3);
  assert.equal(model.calls.updateMany.length, 1);
});

test('approved imported Amazon products are not filtered as temporary recommendations', () => {
  const filter = temporaryExternalAmazonFilter();
  assert.deepEqual(filter.catalogApproved, { $ne: true });
  assert.equal(filter.badge, 'Amazon');
});
