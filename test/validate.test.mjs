import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '../scripts/lib/validate.mjs';
import { paths } from '../scripts/lib/paths.mjs';
import { readJson } from '../scripts/lib/store.mjs';

test('de meegeleverde catalogus is geldig', async () => {
  const catalog = await readJson(paths.catalog);
  const shops = await readJson(paths.shops);
  const { errors } = validateCatalog(catalog, shops);
  assert.deepEqual(errors, []);
});

test('validateCatalog vindt dubbele ids en onbekende verwijzingen', () => {
  const shops = { kruidvat: { name: 'Kruidvat', site: 'https://k.test', searchUrl: 'https://k.test/s?q={q}' } };
  const catalog = {
    categories: [{ id: 'luiers', label: 'Luiers' }],
    products: [
      { id: 'a', name: 'Pampers maat 4', brand: 'Pampers', category: 'luiers', match: { must: ['pampers'] } },
      { id: 'a', name: 'Pampers maat 5', brand: 'Pampers', category: 'zeep', match: { must: ['pampers'] } },
      { id: 'b', name: 'Iets', category: 'luiers', shops: ['onbekend'], match: { must: ['iets'] } },
    ],
  };
  const { errors } = validateCatalog(catalog, shops);
  assert.ok(errors.some((e) => e.includes('dubbel id')));
  assert.ok(errors.some((e) => e.includes('onbekende categorie')));
  assert.ok(errors.some((e) => e.includes('onbekende winkel')));
});

test('validateCatalog signaleert regels die het eigen product uitsluiten', () => {
  const shops = { k: { name: 'K', site: 'https://k.test', searchUrl: 'https://k.test/s?q={q}' } };
  const catalog = {
    categories: [{ id: 'luiers', label: 'Luiers' }],
    products: [
      { id: 'x', name: 'Pampers Baby-Dry maat 4', brand: 'Pampers', category: 'luiers', match: { must: ['huggies'] } },
    ],
  };
  const { errors } = validateCatalog(catalog, shops);
  assert.ok(errors.some((e) => e.includes('eigen naam')));
});

test('validateCatalog controleert de winkelconfiguratie', () => {
  const { errors } = validateCatalog({ products: [] }, { kapot: { name: 'Kapot', site: 'https://x.test', searchUrl: 'https://x.test/s' } });
  assert.ok(errors.some((e) => e.includes('{q}')));
});

test('validateFeeds controleert de feedconfiguratie', async () => {
  const { validateFeeds } = await import('../scripts/lib/validate.mjs');
  const shops = { bol: { name: 'bol' } };

  assert.deepEqual(validateFeeds({ feeds: [] }, shops).errors, []);
  assert.deepEqual(validateFeeds(undefined, shops).errors, []);

  const { errors } = validateFeeds({
    feeds: [
      { id: 'a', shop: 'bol', urlEnv: 'FEED_A_URL' },
      { id: 'a', shop: 'bol', urlEnv: 'FEED_A_URL' },
      { id: 'b', shop: 'onbekend', urlEnv: 'FEED_B_URL' },
      { id: 'c', shop: 'bol', urlEnv: 'https://feed.test/x.csv' },
      { id: 'd', shop: 'bol' },
      { id: 'e', shop: 'bol', urlEnv: 'FEED_E_URL', format: 'json' },
    ],
  }, shops);

  assert.ok(errors.some((e) => e.includes('dubbele feed-id')));
  assert.ok(errors.some((e) => e.includes('onbekende winkel')));
  assert.ok(errors.some((e) => e.includes('secretnaam')));
  assert.ok(errors.some((e) => e.includes("'urlEnv' ontbreekt")));
  assert.ok(errors.some((e) => e.includes('onbekend formaat')));
});

test('de meegeleverde feedconfiguratie is geldig', async () => {
  const { validateFeeds } = await import('../scripts/lib/validate.mjs');
  const feeds = await readJson(paths.feeds);
  const shops = await readJson(paths.shops);
  assert.deepEqual(validateFeeds(feeds, shops).errors, []);
});
