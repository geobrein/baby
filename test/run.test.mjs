import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fetcher } from '../scripts/lib/http.mjs';
import { run, parseArgs } from '../scripts/lib/run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fsSync.readFileSync(path.join(here, 'fixtures', name), 'utf8');

const PAGES = {
  'https://winkel.test/search?text=Pampers%20Baby-Dry%20maat%204%20luiers': 'search-results.html',
  'https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233': 'product-jsonld.html',
};

async function workspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'babyprijs-'));
  const paths = {
    catalog: path.join(dir, 'catalog.json'),
    shops: path.join(dir, 'shops.json'),
    resolved: path.join(dir, 'resolved.json'),
    history: path.join(dir, 'history.json'),
    report: path.join(dir, 'report.json'),
    sitePrices: path.join(dir, 'site', 'prices.json'),
  };
  await fs.writeFile(paths.shops, JSON.stringify({
    test: {
      name: 'Testwinkel',
      site: 'https://winkel.test',
      enabled: true,
      delayMs: 0,
      searchUrl: 'https://winkel.test/search?text={q}',
      productPathPattern: '^/[a-z0-9-]+/p/\\d+',
    },
  }));
  await fs.writeFile(paths.catalog, JSON.stringify({
    categories: [{ id: 'luiers', label: 'Luiers' }],
    products: [
      {
        id: 'pampers-baby-dry-4',
        name: 'Pampers Baby-Dry maat 4',
        brand: 'Pampers',
        category: 'luiers',
        size: '4',
        unit: 'stuk',
        query: 'Pampers Baby-Dry maat 4 luiers',
        match: { must: ['pampers', 'dry'], none: ['pants'] },
      },
      {
        id: 'bestaat-niet',
        name: 'Merkloos maat 4',
        brand: 'Merkloos',
        category: 'luiers',
        size: '4',
        unit: 'stuk',
        query: 'Merkloos maat 4 luiers',
        match: { must: ['merkloos'] },
      },
    ],
  }));
  return { dir, paths };
}

function stubFetcher(log = []) {
  return new Fetcher({
    respectRobots: false,
    defaultDelayMs: 0,
    maxRetries: 0,
    fetch: async (url) => {
      log.push(url);
      const name = PAGES[url];
      if (!name) return { ok: false, status: 404, url, text: async () => '', headers: { get: () => null } };
      return { ok: true, status: 200, url, text: async () => fixture(name), headers: { get: () => null } };
    },
  });
}

test('parseArgs leest de opties', () => {
  const args = parseArgs(['--mock', '--only=kruidvat,etos', '--limit=3', '--no-robots']);
  assert.equal(args.mock, true);
  assert.deepEqual(args.only, ['kruidvat', 'etos']);
  assert.equal(args.limit, 3);
  assert.equal(args.robots, false);
  assert.throws(() => parseArgs(['--onzin']), /Onbekende optie/);
});

test('een volledige ronde schrijft site-data, cache en historie', async (t) => {
  const { dir, paths } = await workspace();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { payload, problems } = await run(parseArgs([]), { paths, log: () => {}, fetcher: stubFetcher() });

  assert.equal(payload.products.length, 1, 'producten zonder prijs komen niet op de site');
  const product = payload.products[0];
  assert.equal(product.id, 'pampers-baby-dry-4');
  assert.equal(product.bestPrice, 39.99);
  assert.equal(product.bestUnitPrice, 0.2499);
  assert.equal(product.offers[0].shopName, 'Testwinkel');
  assert.match(product.offers[0].url, /^https:\/\/winkel\.test\//);
  assert.equal(payload.stats.offers, 1);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].product, 'bestaat-niet');

  const written = JSON.parse(await fs.readFile(paths.sitePrices, 'utf8'));
  assert.equal(written.products.length, 1);
  const resolved = JSON.parse(await fs.readFile(paths.resolved, 'utf8'));
  assert.equal(resolved['pampers-baby-dry-4|test'].url, 'https://winkel.test/pampers-baby-dry-maat-4-160-luiers/p/112233');
  assert.ok(!resolved['bestaat-niet|test'], 'mislukte combinaties blijven niet in de cache staan');
  const history = JSON.parse(await fs.readFile(paths.history, 'utf8'));
  assert.equal(history['pampers-baby-dry-4'].test.length, 1);
});

test('de tweede ronde gebruikt de opgeslagen product-URL', async (t) => {
  const { dir, paths } = await workspace();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await run(parseArgs([]), { paths, log: () => {}, fetcher: stubFetcher() });
  const log = [];
  await run(parseArgs([]), { paths, log: () => {}, fetcher: stubFetcher(log) });

  const searchCalls = log.filter((u) => u.includes('/search?'));
  assert.equal(searchCalls.length, 1, 'alleen het onbekende product wordt opnieuw gezocht');
});

test('demomodus laat cache en historie met rust', async (t) => {
  const { dir, paths } = await workspace();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { payload } = await run(parseArgs(['--mock']), { paths, log: () => {} });
  assert.equal(payload.mock, true);
  assert.equal(payload.products.length, 2);
  assert.ok(payload.products.every((p) => p.offers.length === 1));
  await assert.rejects(fs.access(paths.resolved));
  await assert.rejects(fs.access(paths.history));
});

test('run stopt met een duidelijke melding zonder actieve winkels', async (t) => {
  const { dir, paths } = await workspace();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    run(parseArgs(['--only=onbekend']), { paths, log: () => {} }),
    /Geen actieve winkels/,
  );
});
