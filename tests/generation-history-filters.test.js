import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('generation history exposes the four requested filters with exact type mapping', async () => {
  const source = await fs.readFile('src/App.jsx', 'utf8');

  assert.match(source, /\{ key: 'all', label: 'All' \}/);
  assert.match(source, /\{ key: 'wardrobe', label: 'Wardrobe' \}/);
  assert.match(source, /\{ key: 'custom', label: 'Custom Try-On' \}/);
  assert.match(source, /\{ key: 'ai', label: 'AI Try-On' \}/);
  assert.match(source, /item\?\.type === 'closet'\) return 'wardrobe'/);
  assert.match(source, /item\?\.type === 'custom'\) return 'custom'/);
  assert.match(source, /item\?\.type === 'product'\) return 'ai'/);
  assert.match(source, /api\('\/tryons\/history\?limit=60'/);
  assert.match(source, /className="generation-history-filters" role="tablist"/);
});

test('unified generation history includes wardrobe, custom and catalogue records only', async () => {
  const source = await fs.readFile('server/routes/tryons.js', 'utf8');
  const start = source.indexOf("router.get('/history'");
  const end = source.indexOf("router.get('/custom/latest'", start);
  const route = source.slice(start, end);

  assert.ok(start > 0 && end > start);
  assert.match(route, /TryOn\.find\(userFilter\)/);
  assert.match(route, /CustomTryOn\.find\(userFilter\)/);
  assert.match(route, /ClosetOutfit\.find\(userFilter\)/);
  assert.doesNotMatch(route, /ExternalTryOn/);
  assert.match(route, /productGenerationHistoryItem/);
  assert.match(route, /customGenerationHistoryItem/);
  assert.match(route, /closetGenerationHistoryItem/);
});

test('wardrobe Saved Outfits links to generation history', async () => {
  const source = await fs.readFile('src/App.jsx', 'utf8');
  const savedOutfits = source.slice(source.indexOf('<h2>Saved Outfits</h2>'), source.indexOf('<h2>Saved Outfits</h2>') + 220);

  assert.match(savedOutfits, /href="\/generation-history">See All<\/a>/);
});
