import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnv } from 'vite';
import { productTryOnBlockMessage, styleBotChatIntent, styleBotChatResponse, styleBotProductCompatibility } from '../src/utils/styleBot.js';

const readyUser = { tokens: 1, bodyPhotoUrl: '/profile.jpg', bodyPhotoStatus: 'ready' };

test('greetings and styling advice are ordinary chat, including non-fashion context', () => {
  for (const message of ['hey', 'hi', 'hello', 'hii', 'HI!', 'what should I wear?', 'what should I wear to a food festival?', 'how should I dress for a phone launch?', 'What shoes go with that?', 'Which shirt suits navy trousers?']) {
    assert.deepEqual(styleBotChatIntent(message), { productSearch: false, error: '' }, message);
  }
});

test('fashion searches and color names do not trigger incompatible-product errors', () => {
  for (const message of ['show me saree under 1000', 'linen shirts under 1500', 'show me a cream shirt', 'coffee brown dress']) {
    assert.deepEqual(styleBotChatIntent(message), { productSearch: true, error: '' }, message);
  }
});

test('clear non-fashion product searches get a fashion-specific explanation', () => {
  for (const item of ['toothpaste', 'phone', 'food', 'shampoo']) {
    for (const message of [item, `show me ${item} under 1000`]) {
      assert.equal(styleBotChatIntent(message).productSearch, true);
      assert.match(styleBotChatIntent(message).error, /outside the fashion catalog/);
    }
  }
});

test('reply wins over message and is retained without products or with unavailable products', () => {
  for (const products of [[], [{ name: 'Saree', aiTryOnAvailable: false }]]) {
    assert.deepEqual(styleBotChatResponse({ reply: 'Hello! How can I help you style today?', message: 'OK', products, conversationId: 'session-1' }), {
      reply: 'Hello! How can I help you style today?', products, conversationId: 'session-1'
    });
  }
  assert.equal(styleBotChatResponse({ reply: 'What is the occasion?' }).reply, 'What is the occasion?');
  assert.ok(styleBotChatResponse({ products: [] }).reply);
});

test('legacy recommendation shapes preserve both chat text and suggestions', () => {
  const products = [{ name: 'Kurta' }];
  for (const payload of [{ recommendations: products }, { items: products }, { suggestions: products }, { suggestions: { products } }]) {
    assert.deepEqual(styleBotChatResponse({ ...payload, text: 'Try this kurta.' }).products, products);
  }
});

test('either explicit false flag disables try-on even if the other is true', () => {
  for (const product of [{ aiTryOnAvailable: false }, { tryOnAvailable: false }, { aiTryOnAvailable: false, tryOnAvailable: true }, { aiTryOnAvailable: true, tryOnAvailable: false }]) {
    assert.match(productTryOnBlockMessage(product, readyUser), /unavailable/);
  }
  assert.equal(productTryOnBlockMessage({}, readyUser), '');
  assert.equal(productTryOnBlockMessage({ aiTryOnAvailable: true, tryOnAvailable: true }, readyUser), '');
});

test('try-on requires a usable profile and enough credits', () => {
  for (const user of [null, { tokens: 1 }, { ...readyUser, bodyPhotoStatus: 'generating' }, { ...readyUser, bodyPhotoStatus: 'failed' }, { ...readyUser, tokens: 0 }, { ...readyUser, tokens: undefined }]) {
    assert.ok(productTryOnBlockMessage({}, user));
  }
  // Existing exact-photo profiles use the uploaded status without preprocessing.
  assert.equal(productTryOnBlockMessage({}, { ...readyUser, bodyPhotoStatus: 'uploaded' }), '');
});

test('try-on compatibility depends on the product, not conversation wording', () => {
  assert.equal(styleBotProductCompatibility({ name: 'Cotton Saree', category: 'Sarees' }, 'phone').compatible, true);
  assert.equal(styleBotProductCompatibility({ name: 'Toothpaste' }, 'saree').compatible, false);
});

test('production build resolves the production API, not the development override', () => {
  assert.equal(loadEnv('production', process.cwd(), 'VITE_').VITE_API_BASE_URL, 'https://api.lookmefy.in');
});
