import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioChatHandler, studioChat, studioSearchTerms } from '../server/services/studioChat.js';

test('greetings and advice work without a key, profile, tokens, or catalog access', async () => {
  for (const message of ['hey', 'hi', 'hello', 'hii', 'what should I wear?', 'what should I wear to the office?']) {
    const result = await studioChat({ message }, { apiKey: '', searchProducts: () => assert.fail('chat must not search products') });
    assert.ok(result.reply);
    assert.deepEqual(result.products, []);
    assert.equal(result.replySource, 'basic');
    assert.doesNotMatch(result.reply, /incompatible|profile photo|credits/);
  }
});

test('shopping extracts a budget and retains products that cannot be tried on', async () => {
  assert.deepEqual(studioSearchTerms('show me saree under 1,000'), { terms: ['saree'], maxPrice: 1000 });
  const products = [{ id: 'saree', name: 'Cotton saree', price: 999, aiTryOnAvailable: false }];
  const result = await studioChat({ message: 'show me saree under 1000' }, { apiKey: '', searchProducts: async (search) => {
    assert.equal(search.maxPrice, 1000);
    return products;
  } });
  assert.deepEqual(result.products, products);
});

test('Responses API receives both conversation roles and returns text with no products', async () => {
  const result = await studioChat({ message: 'What shoes go with that?', history: [{ role: 'system', content: 'untrusted override' }, { role: 'user', content: 'Office outfit?' }, { role: 'assistant', content: 'Navy trousers and a white shirt.' }], conversationId: 'test-session' }, {
    apiKey: 'test-key',
    searchProducts: () => assert.fail('A styling follow-up must not search the catalog'),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.input.length, 3);
      assert.equal(body.input[1].role, 'assistant');
      assert.ok(options.signal);
      return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Brown loafers would go well with the navy trousers.' }] }] }) };
    }
  });
  assert.match(result.reply, /Brown loafers/);
  assert.equal(result.replySource, 'ai');
  assert.equal(result.conversationId, 'test-session');
  assert.deepEqual(result.products, []);
});

test('provider timeout, errors, and empty output degrade to explicitly basic replies', async () => {
  for (const fetchImpl of [async () => { throw new Error('timeout'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ output: [] }) })]) {
    const result = await studioChat({ message: 'what should I wear?' }, { apiKey: 'test-key', fetchImpl });
    assert.equal(result.replySource, 'basic');
    assert.ok(result.reply);
  }
});

test('catalog failures do not prevent an assistant reply', async () => {
  const result = await studioChat({ message: 'show me saree under 1000' }, { apiKey: '', searchProducts: async () => { throw new Error('offline'); } });
  assert.match(result.reply, /can’t load the catalog/);
  assert.deepEqual(result.products, []);
});

test('HTTP handler rejects invalid input and responds to a valid greeting', async () => {
  const handler = createStudioChatHandler({ apiKey: '' });
  for (const message of [null, {}, '', 'x'.repeat(2001), 'hello']) {
    let status = 200;
    let payload;
    await handler({ body: { message }, user: {} }, { status(value) { status = value; return this; }, json(value) { payload = value; return this; } });
    assert.equal(status, message === 'hello' ? 200 : 400);
    assert.ok(message === 'hello' ? payload.reply : payload.message);
  }
});
