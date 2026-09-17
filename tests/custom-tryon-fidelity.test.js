import assert from 'node:assert/strict';
import test from 'node:test';
import { customTryOnSettings, promptForProduct } from '../server/utils/tryOnPrompts.js';

test('unclassified custom uploads do not force a complete outfit', () => {
  const settings = customTryOnSettings();
  assert.equal(settings.key, 'custom_auto');
  assert.equal(settings.turbo, false);
  assert.doesNotMatch(settings.prompt, /including BOTH|Transfer BOTH|COMPLETE outfit/);
  assert.match(settings.prompt, /multiple pieces only when each piece is clearly shown/);
  assert.match(settings.prompt, /do not invent additional matching garments/);
});

test('custom reference fidelity preserves construction instead of matching only color', () => {
  const { prompt } = customTryOnSettings();
  assert.match(prompt, /strapless or bandeau design must stay strapless/);
  assert.match(prompt, /do not add shoulder or halter straps/);
  assert.match(prompt, /center fastening/);
  assert.match(prompt, /print placement/);
});

test('explicit custom garment scopes retain their placement constraints', () => {
  for (const key of ['upper', 'lower', 'full_outfit', 'shoes', 'watch', 'glasses', 'hat', 'accessory']) {
    const settings = customTryOnSettings({ promptKey: key });
    assert.equal(settings.key, key);
    assert.equal(settings.turbo, false);
    assert.match(settings.prompt, /Reproduce the same garment/);
  }
  assert.match(customTryOnSettings({ promptKey: 'upper' }).prompt, /STRICTLY preserve the person's existing lower-body clothing/);
});

test('category selection works, and invalid keys fall back to visible garment scope', () => {
  assert.equal(customTryOnSettings({ category: 'dress' }).key, 'full_outfit');
  assert.equal(customTryOnSettings({ category: 'tops' }).key, 'upper');
  assert.equal(customTryOnSettings({ promptKey: 'unknown' }).key, 'custom_auto');
});

test('catalog prompt selection keeps its existing behavior', () => {
  assert.equal(promptForProduct({ name: 'Evening dress' }).key, 'full_outfit');
  assert.equal(promptForProduct({ name: 'Cotton shirt' }).key, 'upper');
});
