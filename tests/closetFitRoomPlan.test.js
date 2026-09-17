import assert from 'node:assert/strict';
import test from 'node:test';
import { closetWanPrompt, imageMimeTypeFromBytes, selectFitRoomClosetPlan } from '../server/routes/closet.js';

function closetItem(overrides = {}) {
  const id = overrides.id || `${overrides.category || 'item'}-1`;
  return {
    _id: { toString: () => id },
    name: overrides.name || 'Closet item',
    category: overrides.category || 'tops',
    color: '',
    fabric: '',
    pattern: '',
    season: 'all-season',
    formality: 'any',
    tags: [],
    occasions: [],
    visualProfile: null,
    image: { path: `uploads/${id}.jpg` },
    ...overrides
  };
}

test('selectFitRoomClosetPlan uses lower cloth type for a bottom-only look', () => {
  const plan = selectFitRoomClosetPlan([
    closetItem({ id: 'bottom-1', name: 'Blue bottoms', category: 'bottoms' })
  ]);

  assert.equal(plan.clothType, 'lower');
  assert.equal(plan.garmentItem.name, 'Blue bottoms');
  assert.equal(plan.requiresWan, false);
});

test('selectFitRoomClosetPlan keeps combo metadata for upper and lower items', () => {
  const plan = selectFitRoomClosetPlan([
    closetItem({ id: 'top-1', name: 'Black tee', category: 'tops' }),
    closetItem({ id: 'bottom-1', name: 'Blue jeans', category: 'bottoms' })
  ]);

  assert.equal(plan.clothType, 'combo');
  assert.equal(plan.upperItem.name, 'Black tee');
  assert.equal(plan.lowerItem.name, 'Blue jeans');
  assert.deepEqual(plan.renderedItemIds, ['top-1', 'bottom-1']);
  assert.equal(plan.requiresWan, true);
  assert.deepEqual(plan.ignoredItems, []);
});

test('selectFitRoomClosetPlan keeps one-piece garments as full_set', () => {
  const plan = selectFitRoomClosetPlan([
    closetItem({ id: 'dress-1', name: 'Evening dress', category: 'dresses' })
  ]);

  assert.equal(plan.clothType, 'full_set');
  assert.equal(plan.garmentItem.name, 'Evening dress');
  assert.equal(plan.requiresWan, false);
});

test('selectFitRoomClosetPlan routes accessory-only looks through Wan', () => {
  const plan = selectFitRoomClosetPlan([
    closetItem({ id: 'shoe-1', name: 'Loafers', category: 'shoes' }),
    closetItem({ id: 'cap-1', name: 'Cap', category: 'accessories' })
  ]);

  assert.equal(plan.clothType, 'wardrobe_multi');
  assert.equal(plan.requiresWan, true);
  assert.equal(plan.items.length, 2);
  assert.deepEqual(plan.ignoredItems, []);
});

test('selectFitRoomClosetPlan tracks extra pieces while routing through Wan', () => {
  const plan = selectFitRoomClosetPlan([
    closetItem({ id: 'top-1', name: 'Black tee', category: 'tops' }),
    closetItem({ id: 'bottom-1', name: 'Blue jeans', category: 'bottoms' }),
    closetItem({ id: 'shoe-1', name: 'Loafers', category: 'shoes' })
  ]);

  assert.equal(plan.clothType, 'combo');
  assert.equal(plan.requiresWan, true);
  assert.deepEqual(plan.renderedItemIds, ['top-1', 'bottom-1']);
  assert.deepEqual(plan.ignoredItems.map((item) => item.name), ['Loafers']);
});

test('imageMimeTypeFromBytes detects WebP even when provider headers are wrong', () => {
  const webpHeader = Buffer.from('52494646000000005745425056503820', 'hex');
  assert.equal(imageMimeTypeFromBytes(webpHeader), 'image/webp');
});

for (const category of ['outerwear', 'tops']) {
  test(`jacket categorized as ${category} uses prompted generation with proper sleeve placement`, () => {
    const plan = selectFitRoomClosetPlan([
      closetItem({ id: 'jacket-1', name: 'Black leather jacket', category })
    ]);
    assert.equal(plan.requiresWan, true);
    const prompt = closetWanPrompt(plan);
    assert.match(prompt, /outerwear, outermost layer/);
    assert.match(prompt, /both arms completely through the sleeves/);
    assert.match(prompt, /keep the shopper base top beneath it/);
  });
}

test('ordinary top remains on FitRoom and does not get jacket instructions', () => {
  const plan = selectFitRoomClosetPlan([closetItem({ name: 'Cotton tee' })]);
  assert.equal(plan.requiresWan, false);
  assert.doesNotMatch(closetWanPrompt(plan), /Dress the shopper fully in the selected outerwear/);
});

test('layered outfit references preserve selection order and distinguish the jacket from the base top', () => {
  const plan = selectFitRoomClosetPlan([
    closetItem({ id: 'top-1', name: 'White tee', category: 'tops' }),
    closetItem({ id: 'bottom-1', name: 'Green trousers', category: 'bottoms' }),
    closetItem({ id: 'jacket-1', name: 'Leather jacket', category: 'outerwear' })
  ]);
  const prompt = closetWanPrompt(plan);
  assert.match(prompt, /Reference 1: White tee \(tops\)/);
  assert.match(prompt, /Reference 2: Green trousers \(bottoms\)/);
  assert.match(prompt, /Reference 3: Leather jacket \(outerwear, outermost layer\)/);
  assert.match(prompt, /left to right, then top to bottom/);
  assert.match(prompt, /Transfer only the named selected item/);
  assert.match(prompt, /Layer it over the selected top or dress/);
});
