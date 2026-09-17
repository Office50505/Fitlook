import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { readStoredFile } from '../server/utils/storage.js';

test('legacy wardrobe images fall back to Bunny only when local files are missing', async (t) => {
  const oldProvider = process.env.STORAGE_PROVIDER;
  const oldCdn = process.env.BUNNY_CDN_BASE_URL;
  t.after(() => {
    for (const [key, value] of [['STORAGE_PROVIDER', oldProvider], ['BUNNY_CDN_BASE_URL', oldCdn]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    t.mock.restoreAll();
  });
  process.env.STORAGE_PROVIDER = 'bunny';
  process.env.BUNNY_CDN_BASE_URL = 'https://media.example.com';
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  let status = 200;
  const requests = [];
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return new Response(status === 200 ? png : '', { status, headers: { 'content-type': 'image/png' } });
  });
  let localError = 'ENOENT';
  t.mock.method(fs, 'readFile', async () => {
    if (localError) throw Object.assign(new Error('local read failed'), { code: localError });
    return png;
  });
  const file = { path: 'uploads/users/test/closet/item.png', storage: 'local', mimetype: 'image/png' };
  assert.deepEqual((await readStoredFile(file, 'closet item')).buffer, png);
  assert.equal(requests[0], 'https://media.example.com/users/test/closet/item.png');
  localError = null;
  await readStoredFile(file);
  assert.equal(requests.length, 1);
  localError = 'EACCES';
  await assert.rejects(readStoredFile(file), { code: 'EACCES' });
  assert.equal(requests.length, 1);
  localError = 'ENOENT';
  status = 404;
  await assert.rejects(readStoredFile(file, 'closet item'), /file was not found in storage\. Please upload it again/);
  process.env.STORAGE_PROVIDER = 'local';
  await assert.rejects(readStoredFile(file), { code: 'ENOENT' });
  assert.equal(requests.length, 2);
});
