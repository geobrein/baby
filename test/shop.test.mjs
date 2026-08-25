import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fetcher } from '../scripts/lib/http.mjs';
import { extractCandidates, resolveProductUrl, fetchOffer, titleFromUrl } from '../scripts/lib/shop.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

const shop = {
  name: 'Testwinkel',
  site: 'https://winkel.test',
  searchUrl: 'https://winkel.test/search?text={q}',
  productPathPattern: '^/[a-z0-9-]+/p/\\d+',
  delayMs: 0,
};

const product = {
  id: 'pampers-baby-dry-4',
  name: 'Pampers Baby-Dry maat 4',
  brand: 'Pampers',
  size: '4',
  query: 'Pampers Baby-Dry maat 4 luiers',
  match: { must: ['pampers', 'dry'], none: ['pants', 'broekjes'] },
};

const PAGES = {
  'https://winkel.test/search?text=Pampers%20Baby-Dry%20maat%204%20luiers': 'search-results.html',
  'https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233': 'product-jsonld.html',
};

function stubFetch(log = []) {
  return async (url) => {
    log.push(url);
    const name = PAGES[url];
    if (!name) {
      return { ok: false, status: 404, url, text: async () => '', headers: { get: () => null } };
    }
    return { ok: true, status: 200, url, text: async () => fixture(name), headers: { get: () => null } };
  };
}

function testFetcher(log) {
  return new Fetcher({ fetch: stubFetch(log), respectRobots: false, defaultDelayMs: 0, maxRetries: 0 });
}

test('titleFromUrl maakt een leesbare titel van de slug', () => {
  assert.equal(titleFromUrl('https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233'), 'pampers baby dry maat 4 160 luiers');
});

test('extractCandidates houdt alleen productlinks van dezelfde winkel over', () => {
  const candidates = extractCandidates(fixture('search-results.html'), shop, 'https://winkel.test/search');
  const urls = candidates.map((c) => c.url);
  assert.equal(urls.length, 3);
  assert.ok(urls.includes('https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233'));
  assert.ok(!urls.some((u) => u.includes('anderewinkel')));
  assert.ok(!urls.some((u) => u.includes('klantenservice')));
});

test('resolveProductUrl kiest de juiste maat en variant', async () => {
  const result = await resolveProductUrl(testFetcher([]), 'test', shop, product);
  assert.equal(result.url, 'https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233');
  assert.equal(result.page.price, 39.99);
});

test('fetchOffer gebruikt een bekende URL zonder opnieuw te zoeken', async () => {
  const log = [];
  const offer = await fetchOffer(testFetcher(log), 'test', shop, product, 'https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233');
  assert.equal(offer.ok, true);
  assert.equal(offer.price, 39.99);
  assert.equal(offer.unitPrice, 0.2499);
  assert.equal(offer.unitLabel, 'per stuk');
  assert.deepEqual(offer.packSize, { amount: 160, unit: 'stuk' });
  assert.equal(log.length, 1, 'geen extra zoekopdracht nodig');
});

test('fetchOffer zoekt opnieuw als de opgeslagen URL niet meer werkt', async () => {
  const log = [];
  const offer = await fetchOffer(testFetcher(log), 'test', shop, product, 'https://winkel.test/verdwenen-product/p/9999');
  assert.equal(offer.ok, true);
  assert.equal(offer.url, 'https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233');
  assert.ok(log.length > 1);
});

test('fetchOffer meldt netjes dat er niets gevonden is', async () => {
  const onbekend = { ...product, id: 'huggies-4', name: 'Huggies maat 4', brand: 'Huggies', match: { must: ['huggies'] } };
  const offer = await fetchOffer(testFetcher([]), 'test', shop, onbekend, null);
  assert.equal(offer.ok, false);
  assert.equal(offer.price, null);
  assert.match(offer.error, /zoekresultaat|overeen/);
});

test('Fetcher weigert URLs die robots.txt verbiedt', async () => {
  const robots = 'User-agent: *\nDisallow: /search';
  const fetcher = new Fetcher({
    defaultDelayMs: 0,
    maxRetries: 0,
    fetch: async (url) => ({
      ok: true, status: 200, url,
      text: async () => (url.endsWith('/robots.txt') ? robots : '<html></html>'),
      headers: { get: () => null },
    }),
  });
  const blocked = await fetcher.text('https://winkel.test/search?text=x');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /robots/);
  const allowed = await fetcher.text('https://winkel.test/product/p/1');
  assert.equal(allowed.ok, true);
});
